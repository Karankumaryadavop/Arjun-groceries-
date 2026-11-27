import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  GlobalErrorBoundary,
  normalizeBoundaryError,
  shouldResetErrorBoundary,
} from './ErrorBoundary';

test('normalizeBoundaryError formats Error objects, strings, and unknown values safely', () => {
  const fromErr = normalizeBoundaryError(new TypeError('Cannot read properties of undefined'));
  assert.equal(fromErr.name, 'TypeError');
  assert.equal(fromErr.message, 'Cannot read properties of undefined');

  const fromString = normalizeBoundaryError('Unexpected render failure');
  assert.equal(fromString.name, 'Error');
  assert.equal(fromString.message, 'Unexpected render failure');

  const fromUnknown = normalizeBoundaryError(null);
  assert.equal(fromUnknown.name, 'Error');
  assert.match(fromUnknown.message, /unexpected application error/i);

  const longMsg = 'x'.repeat(500);
  const truncated = normalizeBoundaryError(new Error(longMsg));
  assert.ok(truncated.message.length <= 301);
  assert.ok(truncated.message.endsWith('…'));
});

test('shouldResetErrorBoundary triggers only when resetKey changes between defined values', () => {
  assert.equal(shouldResetErrorBoundary('DASHBOARD', 'SALES'), true);
  assert.equal(shouldResetErrorBoundary('DASHBOARD', 'DASHBOARD'), false);
  assert.equal(shouldResetErrorBoundary(undefined, 'DASHBOARD'), false);
  assert.equal(shouldResetErrorBoundary('DASHBOARD', undefined), false);
});

test('GlobalErrorBoundary.getDerivedStateFromError captures errors into fallback state', () => {
  const derived = GlobalErrorBoundary.getDerivedStateFromError(new Error('Boom in view'));
  assert.equal(derived.hasError, true);
  assert.equal(derived.error?.message, 'Boom in view');
});

test('GlobalErrorBoundary renders children cleanly when no error has occurred', () => {
  const html = renderToStaticMarkup(
    React.createElement(GlobalErrorBoundary, {
      scope: 'app',
      children: React.createElement('div', null, 'Healthy Store View'),
    })
  );
  assert.match(html, /Healthy Store View/);
  assert.doesNotMatch(html, /global-error-boundary-fallback/);
});

test('GlobalErrorBoundary renders graceful fallback UI and supports reset & navigation recovery', () => {
  let homeCalled = false;
  const captured: { error: Error | null } = { error: null };

  const instance = new GlobalErrorBoundary({
    scope: 'view',
    resetKey: 'ANALYTICS',
    onNavigateHome: () => {
      homeCalled = true;
    },
    onError: (err) => {
      captured.error = err;
    },
    children: React.createElement('div', null, 'Recovered Content'),
  });

  // Simulate React error boundary lifecycle
  const derived = GlobalErrorBoundary.getDerivedStateFromError(new Error('Chart crashed'));
  instance.state = {
    ...instance.state,
    ...derived,
  };

  // Capture setState calls for componentDidCatch and handleReset
  const setStatePatch = (updater: any) => {
    const patch = typeof updater === 'function' ? updater(instance.state) : updater;
    instance.state = { ...instance.state, ...patch };
  };
  instance.setState = setStatePatch as any;

  instance.componentDidCatch(new Error('Chart crashed'), {
    componentStack: '\n    at AnalyticsView',
  });
  assert.equal(captured.error?.message, 'Chart crashed');
  assert.equal(instance.state.componentStack, '\n    at AnalyticsView');

  const fallbackElement = instance.render();
  const fallbackHtml = renderToStaticMarkup(fallbackElement as React.ReactElement);
  assert.match(fallbackHtml, /global-error-boundary-fallback/);
  assert.match(fallbackHtml, /This screen ran into an unexpected error/);
  assert.match(fallbackHtml, /Your local business data in Arjun Groceries is safe/);
  assert.match(fallbackHtml, /Try Again/);
  assert.match(fallbackHtml, /Go to Dashboard/);
  assert.match(fallbackHtml, /Reload App/);

  // Simulate clicking Go to Dashboard
  instance.handleGoHome();
  assert.equal(instance.state.hasError, false);
  assert.equal(homeCalled, true);

  // Re-error and test automatic reset when resetKey changes (tab navigation)
  instance.state = {
    ...instance.state,
    hasError: true,
    error: normalizeBoundaryError(new Error('Tab error')),
  };
  (instance as any).props = { ...instance.props, resetKey: 'SALES' };
  instance.componentDidUpdate({
    scope: 'view',
    resetKey: 'ANALYTICS',
    children: null,
  });
  assert.equal(instance.state.hasError, false);
});
