export default function ShareLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <div className="share-scroll">{children}</div>;
}
