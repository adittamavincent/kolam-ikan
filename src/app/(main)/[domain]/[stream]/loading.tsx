import { MainContentLoading } from "@/components/layout/MainContentLoading";

export default function StreamLoading() {
  return (
    <MainContentLoading
      title="Opening stream"
      hint="Fetching the log, canvas, and stream context."
      mode="stream"
    />
  );
}
