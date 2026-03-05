interface BadgeProps {
  className?: string;
  children: React.ReactNode;
}

export function Badge({ className = "", children }: BadgeProps) {
  return <span className={`badge ${className}`}>{children}</span>;
}
