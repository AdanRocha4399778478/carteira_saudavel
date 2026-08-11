export function PageHeader({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
      <div className="flex flex-col gap-3 px-4 py-4 md:px-8">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
          <div className="min-w-0">
            <h1 className="font-display truncate text-xl font-bold md:text-2xl">{title}</h1>
            {description ? (
              <p className="truncate text-sm text-muted-foreground">{description}</p>
            ) : null}
          </div>
        </div>
        {children ? <div className="flex flex-wrap items-end gap-2">{children}</div> : null}
      </div>
    </header>
  );
}
