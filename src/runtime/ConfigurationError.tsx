export function ConfigurationError({ message }: { message: string }) {
  return (
    <main className="grid min-h-[100dvh] place-items-center bg-surface px-6 text-center text-ink">
      <section className="max-w-lg rounded-bezel border border-line bg-card p-6">
        <h1 className="text-lg font-semibold">DEEV configuration error</h1>
        <p className="mt-3 text-sm leading-6 text-ink2">{message}</p>
      </section>
    </main>
  );
}
