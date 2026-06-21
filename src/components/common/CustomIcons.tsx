import React from 'react';

export interface CustomIconProps extends React.SVGProps<SVGSVGElement> {
  size?: number | string;
}

// Custom Instagram-style Reels Icon (rounded clapperboard with slanted lines and a play triangle in the center)
export const ReelsIcon = ({ className, size = 24, ...props }: CustomIconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    width={size}
    height={size}
    className={className}
    {...props}
  >
    <rect x="3" y="3" width="18" height="18" rx="4" ry="4" />
    <line x1="3" y1="9" x2="21" y2="9" />
    <line x1="11" y1="3" x2="8" y2="9" />
    <line x1="16" y1="3" x2="13" y2="9" />
    <polygon points="10 12 15 15 10 18" />
  </svg>
);

// Custom Video Call Icon (standard video camera with a play triangle inside the body)
export const VideoCallIcon = ({ className, size = 24, ...props }: CustomIconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    width={size}
    height={size}
    className={className}
    {...props}
  >
    <path d="m22 8-6 4 6 4V8Z" />
    <rect width="14" height="12" x="2" y="6" rx="2" ry="2" />
    <polygon points="7 9.5 11 12 7 14.5" />
  </svg>
);

// Curvy Chevron Left (sharp tip rounded with a small bezier curve/arc)
export const CurvyChevronLeft = ({ className, size = 24, ...props }: CustomIconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    width={size}
    height={size}
    className={className}
    {...props}
  >
    <path d="M15 18 C15 18, 10 13, 9.3 12.3 a 1 1 0 0 1 0 -0.6 C10 11, 15 6, 15 6" />
  </svg>
);

// Curvy Chevron Right (sharp tip rounded with a small bezier curve/arc)
export const CurvyChevronRight = ({ className, size = 24, ...props }: CustomIconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    width={size}
    height={size}
    className={className}
    {...props}
  >
    <path d="M9 18 C9 18, 14 13, 14.7 12.3 a 1 1 0 0 0 0 -0.6 C14 11, 9 6, 9 6" />
  </svg>
);
