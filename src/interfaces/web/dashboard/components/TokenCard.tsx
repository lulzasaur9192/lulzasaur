interface TokenCardProps {
  label: string;
  value: string | number;
}

export function TokenCard({ label, value }: TokenCardProps) {
  return (
    <div className="token-card">
      <div className="token-card-label">{label}</div>
      <div className="token-card-value">{value}</div>
    </div>
  );
}
