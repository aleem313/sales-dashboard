export default function HelloWorld() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-bold tracking-tight">
          Hello World!
        </h1>
        <p className="text-muted-foreground text-lg">
          Sales Dashboard is live. Deployment pipeline is working.
        </p>
        <p className="text-sm text-muted-foreground">
          Deployed: {new Date().toISOString().split("T")[0]}
        </p>
      </div>
    </div>
  );
}
