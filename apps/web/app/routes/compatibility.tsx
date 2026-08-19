import { CheckCircle2, CircleDashed, XCircle } from "lucide-react";
import { SiteShell } from "../components/SiteShell";

const rows = [
  {
    host: "macOS 12+",
    ios: "27.0 · exact build pending",
    transport: "Previously paired same-LAN Wi-Fi",
    result: "Probe set/move/clear passed; GUI physical acceptance pending",
    status: "partial" as const,
  },
  {
    host: "macOS 12+",
    ios: "26.5.2",
    transport: "Previously paired same-LAN Wi-Fi",
    result: "Enumeration passed; location service unavailable",
    status: "failed" as const,
  },
  {
    host: "macOS 12+",
    ios: "17, 18, 26, or 27",
    transport: "USB",
    result: "Physical qualification deferred",
    status: "pending" as const,
  },
  {
    host: "Windows 10/11 x64",
    ios: "17, 18, 26, or 27",
    transport: "USB or Wi-Fi",
    result: "Physical qualification deferred",
    status: "pending" as const,
  },
];

const icons = { partial: CheckCircle2, pending: CircleDashed, failed: XCircle };

export default function Compatibility() {
  return (
    <SiteShell>
      <main className="mx-auto max-w-6xl px-6 py-16">
        <h1 className="text-4xl font-semibold md:text-6xl">Compatibility</h1>
        <p className="mt-5 max-w-3xl text-lg leading-8 text-muted-foreground">
          Enumeration is not a support claim. Enigma advertises a host, iOS build, and transport
          only after physical set, move, clear, exit recovery, GPX recovery, and joystick recovery.
        </p>
        <div className="mt-10 overflow-x-auto rounded-2xl border border-border">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-surface-secondary">
              <tr>
                {["Host", "iOS", "Transport", "Current evidence"].map((heading) => (
                  <th className="px-4 py-3 font-semibold" key={heading}>
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const Icon = icons[row.status];
                return (
                  <tr
                    className="border-t border-border"
                    key={`${row.host}-${row.ios}-${row.transport}`}
                  >
                    <td className="px-4 py-4 font-medium">{row.host}</td>
                    <td className="px-4 py-4">{row.ios}</td>
                    <td className="px-4 py-4">{row.transport}</td>
                    <td className="px-4 py-4 text-muted-foreground">
                      <span className="flex items-start gap-2">
                        <Icon className="mt-0.5 shrink-0" size={16} />
                        {row.result}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-6 text-sm text-muted-foreground">
          The current desktop build enables only a network device reporting iOS 27. USB, Windows,
          and every other iOS version fail closed.
        </p>
      </main>
    </SiteShell>
  );
}
