"use client";

import { useEffect, useState } from "react";
import type { Org } from "@/lib/workflow-models";
import { useLocalStorageValue } from "@/lib/use-local-storage";
import {
  Alert,
  Badge,
  Card,
  Field,
  PageHeader,
  Select,
  Tabs,
  TextInput,
} from "@/components/workflows-ui";

type SettingsTab = "perfil" | "organizacao" | "equipe" | "seguranca" | "preferencias";
type ThemePref = "light" | "dark" | "system";

const THEME_KEY = "ath-theme";

function applyTheme(pref: ThemePref) {
  const root = document.documentElement;
  const dark =
    pref === "dark" ||
    (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  root.classList.toggle("dark", dark);
  document.body.style.background = dark ? "#060f22" : "";
  document.body.style.color = dark ? "#ffffff" : "";
  try {
    localStorage.setItem(THEME_KEY, pref);
  } catch {
    /* storage indisponível: preferência vale só para a sessão */
  }
}

function readTheme(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* ignore */
  }
  return "system";
}

/* ================= PERFIL ================= */

function ProfileTab({ email }: { email: string | null }) {
  return (
    <Card className="max-w-xl p-5">
      <div className="space-y-4">
        <Field
          label="Email"
          htmlFor="profile-email"
          hint="Gerenciado pela autenticação. A edição de perfil ainda não está disponível na API."
        >
          <TextInput id="profile-email" value={email ?? "—"} disabled />
        </Field>
        <Field label="Nome de exibição" htmlFor="profile-name" hint="Em breve.">
          <TextInput id="profile-name" value="" placeholder="Em breve" disabled />
        </Field>
      </div>
    </Card>
  );
}

/* ================= ORGANIZAÇÃO ================= */

function OrgTab({ orgs }: { orgs: Org[] }) {
  if (orgs.length === 0) {
    return (
      <Alert tone="neutral" title="Organização">
        Nenhuma organização vinculada à sua conta.
      </Alert>
    );
  }
  return (
    <Card className="max-w-xl p-5">
      <div className="space-y-4">
        {orgs.map((o) => (
          <div key={o.id} className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-navy-900 [.dark_&]:text-white">{o.name}</p>
              <p className="font-mono text-xs text-ink-500">{o.id}</p>
            </div>
            {o.role ? <Badge tone="info">{o.role}</Badge> : null}
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ================= EQUIPE ================= */

function TeamTab() {
  return (
    <Alert tone="neutral" title="Equipe em breve">
      A listagem de membros da organização ainda não é exposta pela API (
      <code className="font-mono">/api/v1</code>). Nenhum dado é exibido aqui até o endpoint
      existir.
    </Alert>
  );
}

/* ================= SEGURANÇA ================= */

function SecurityTab() {
  return (
    <div className="max-w-3xl">
      <Alert tone="neutral" title="Chaves de API em breve">
        A gestão de chaves de API ainda não foi implementada no backend. Nenhuma chave é exibida,
        criada ou armazenada por esta tela — quando o endpoint existir, a criação mostrará a
        chave uma única vez, com opção de cópia.
      </Alert>
    </div>
  );
}

/* ================= PREFERÊNCIAS ================= */

function PreferencesTab() {
  // SSR-safe persisted preference (no set-state-in-effect): the DOM is
  // synchronized in effects below, which never call setState.
  const [stored, setStored] = useLocalStorageValue(THEME_KEY);
  const theme: ThemePref =
    stored === "light" || stored === "dark" || stored === "system"
      ? stored
      : "system";

  // Apply the preference to the document (external system sync).
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Follow OS-level changes while the preference is "system".
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (readTheme() === "system") applyTheme("system");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  function changeTheme(pref: ThemePref) {
    // Persisted via the hook; the applyTheme effect above runs next render.
    setStored(pref);
  }

  return (
    <Card className="max-w-xl p-5">
      <div className="space-y-5">
        <Field
          label="Tema"
          htmlFor="pref-theme"
          hint="Aplicado imediatamente e salvo neste navegador."
        >
          <Select
            id="pref-theme"
            value={theme}
            onChange={(e) => changeTheme(e.target.value as ThemePref)}
          >
            <option value="system">Sistema</option>
            <option value="light">Claro</option>
            <option value="dark">Escuro</option>
          </Select>
        </Field>
        <Field label="Idioma" htmlFor="pref-lang" hint="Outros idiomas em breve.">
          <Select id="pref-lang" value="pt-BR" disabled>
            <option value="pt-BR">Português (BR)</option>
          </Select>
        </Field>
      </div>
    </Card>
  );
}

/* ================= PAGE ================= */

export default function SettingsClient({ orgs, email }: { orgs: Org[]; email: string | null }) {
  const [tab, setTab] = useState<SettingsTab>("perfil");

  return (
    <div>
      <PageHeader
        title="Configurações"
        subtitle="Perfil, organização, equipe, segurança e preferências."
      />

      <Tabs
        tabs={[
          { id: "perfil", label: "Perfil" },
          { id: "organizacao", label: "Organização" },
          { id: "equipe", label: "Equipe" },
          { id: "seguranca", label: "Segurança" },
          { id: "preferencias", label: "Preferências" },
        ]}
        activeId={tab}
        onChange={(id) => setTab(id as SettingsTab)}
      />

      {tab === "perfil" ? <ProfileTab email={email} /> : null}
      {tab === "organizacao" ? <OrgTab orgs={orgs} /> : null}
      {tab === "equipe" ? <TeamTab /> : null}
      {tab === "seguranca" ? <SecurityTab /> : null}
      {tab === "preferencias" ? <PreferencesTab /> : null}
    </div>
  );
}
