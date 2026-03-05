interface PageHeaderProps {
  title: string;
  subtitle?: string;
}

export function PageHeader({ title, subtitle }: PageHeaderProps) {
  return (
    <div className="header">
      <div className="header-title">{title}</div>
      {subtitle && <div className="header-subtitle">{subtitle}</div>}
    </div>
  );
}
