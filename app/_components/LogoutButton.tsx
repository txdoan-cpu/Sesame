import { logout } from "@/app/(auth)/actions";

export function LogoutButton({ label }: { label: string }) {
  return (
    <form action={logout}>
      <button type="submit" className="min-h-11 rounded-lg border-2 border-current px-4 font-medium">
        {label}
      </button>
    </form>
  );
}
