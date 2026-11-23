import React, { useState } from 'react';
import { Store } from 'lucide-react';

export const ARJUN_GROCERIES_LOGO_SRC = '/assets/aistudio/IMG_20261111_163435_a81dbab5.png';
export const BRAND_NAME = 'Arjun Groceries';
export const BRAND_TAGLINE = 'Shop Smart • Save More';

interface BrandLogoProps {
  sizeClass?: string;
  roundedClass?: string;
  className?: string;
  alt?: string;
}

/**
 * Renders the official uploaded Arjun Groceries logo with its original
 * design, colors, proportions, and tagline preserved. Includes an accessible
 * fallback container if the image fails to load.
 */
export const BrandLogo: React.FC<BrandLogoProps> = ({
  sizeClass = 'w-11 h-11',
  roundedClass = 'rounded-full',
  className = '',
  alt = 'Arjun Groceries — Shop Smart • Save More',
}) => {
  const [imgError, setImgError] = useState(false);

  if (imgError) {
    return (
      <div
        className={`${sizeClass} ${roundedClass} bg-white border border-emerald-200 flex items-center justify-center text-emerald-700 shrink-0 ${className}`}
        aria-label={alt}
      >
        <Store className="w-1/2 h-1/2" />
      </div>
    );
  }

  return (
    <div
      className={`${sizeClass} ${roundedClass} bg-white border border-emerald-200/80 overflow-hidden flex items-center justify-center shrink-0 p-0.5 ${className}`}
    >
      <img
        src={ARJUN_GROCERIES_LOGO_SRC}
        alt={alt}
        referrerPolicy="no-referrer"
        onError={() => setImgError(true)}
        className="w-full h-full object-contain"
      />
    </div>
  );
};
