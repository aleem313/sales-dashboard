import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export default async function Home() {
  const session = await auth();
  if (!session) redirect("/login");

  if (session.user.role === "agent") {
    redirect("/my-dashboard");
  }
  redirect("/dashboard");
}
