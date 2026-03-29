import { MainContentLoading } from "@/components/layout/MainContentLoading";

export default function DomainLoading() {
  return (
    <MainContentLoading
      title="Opening domain"
      hint="Preparing the workspace and navigator for the selected domain."
      mode="domain"
    />
  );
}
