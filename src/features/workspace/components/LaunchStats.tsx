export default function LaunchStats({ items }: { items: { label: string; value: string | number }[] }) {
  return <dl className="launch-stats">{items.map(item => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>;
}
