import { ReactNode } from 'react';

interface FormLabelProps {
  children: ReactNode;
  htmlFor?: string;
  required?: boolean;
  className?: string;
}

/**
 * Bold uppercase label for form fields.
 * Use on all inputs for consistent styling.
 */
export function FormLabel({ children, htmlFor, required, className = '' }: FormLabelProps) {
  return (
    <label
      htmlFor={htmlFor}
      className={`text-xs font-bold uppercase mb-3 block ${className}`}
      style={{ color: 'var(--text-secondary)', letterSpacing: '0.05em' }}
    >
      {children}
      {required && <span style={{ color: 'var(--signal-pass)' }}> *</span>}
    </label>
  );
}
