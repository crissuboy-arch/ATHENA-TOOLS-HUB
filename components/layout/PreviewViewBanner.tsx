import Link from "next/link";
import { t } from "@/lib/i18n";

/**
 * Aviso do modo visualização temporário (só Preview, sem sessão).
 * Deixa claro que isto NÃO é uma sessão: não há dados reais nem
 * ações — só a interface. O login real continua a um clique.
 */
export function PreviewViewBanner() {
  return (
    <div
      role="alert"
      className="border-b-2 border-gold-500 bg-gold-100 px-4 py-3 text-navy-950"
    >
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-4 gap-y-1 px-0 sm:px-6">
        <p className="text-sm font-bold">{t.previewView.title}</p>
        <p className="text-sm">{t.previewView.body}</p>
        <Link
          href="/login"
          className="text-sm font-semibold text-gold-700 underline hover:text-gold-800"
        >
          {t.previewView.loginCta}
        </Link>
      </div>
    </div>
  );
}
