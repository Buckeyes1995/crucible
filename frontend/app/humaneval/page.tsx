import { redirect } from "next/navigation";
export default function HumanEvalRedirect() {
  redirect("/evals?tab=humaneval");
}
