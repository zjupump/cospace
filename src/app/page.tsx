import { Workbench } from "../components/workbench";
import { demoEnabled } from "../server/database";

export const dynamic = "force-dynamic";

export default function Page() {
  return <Workbench demo={demoEnabled()} />;
}
