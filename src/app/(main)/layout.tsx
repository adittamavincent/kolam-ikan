import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ClientMainLayout } from "@/components/layout/ClientMainLayout";
import { KeyboardShortcutsProvider } from "@/components/shared/KeyboardShortcutsProvider";

export default async function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <KeyboardShortcutsProvider>
      <ClientMainLayout userId={user.id}>{children}</ClientMainLayout>
    </KeyboardShortcutsProvider>
  );
}
