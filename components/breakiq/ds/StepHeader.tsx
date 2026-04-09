interface StepHeaderProps {
  stepNumber: number;
  title: string;
  subtitle?: string;
  className?: string;
}

/**
 * Numbered step indicator with glowing gradient box.
 * Use for multi-step forms and guided workflows.
 */
export function StepHeader({ stepNumber, title, subtitle, className = '' }: StepHeaderProps) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div
        className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{
          background: 'var(--gradient-blue)',
          boxShadow: '0 0 20px rgba(59, 130, 246, 0.3)',
        }}
      >
        <span className="text-white font-bold text-base">{stepNumber}</span>
      </div>
      <div>
        <h2 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
          {title}
        </h2>
        {subtitle && (
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
}
