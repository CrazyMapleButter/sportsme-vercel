export default function EmailConfirmedPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 text-slate-100">
      <div className="bg-slate-950 border border-slate-800 rounded-xl p-8 w-full max-w-md text-center shadow-xl">
        <h1 className="text-2xl font-bold mb-4">Email confirmed</h1>
        <p className="text-sm text-slate-300 mb-6">
          Your email has been confirmed successfully.
        </p>
        <p className="text-sm text-slate-400 mb-6">
          You can now go back to the SportsMe site and log in with your account.
        </p>
        <a
          href="/login"
          className="inline-block px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-500 text-sm font-semibold"
        >
          Go to login
        </a>
      </div>
    </div>
  );
}
