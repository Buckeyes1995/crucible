import { redirect } from "next/navigation";
export default function ArenaLeaderboardRedirect() {
  redirect("/arena?tab=leaderboard");
}
