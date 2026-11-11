/* NamaChu — PWA インストールボタン
   NamaHam の実装に倣い、単体起動か NamaSound+ 経由かを判別して案内を出し分ける。
   判別は、親(NamaSound+)が送る setHostContext メッセージを app.js が
   'namachu:enter-hostcontext' イベントに変換したものを受けて行う。 */

import { t } from './i18n.js';
import { openModal, closeModal } from './utils.js';

let deferredInstallPrompt = null;
let insideSoundPlus = false;

const isIOSDevice = /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios/i.test(navigator.userAgent);

export function isStandaloneDisplay() {
  return window.matchMedia('(display-mode: standalone)').matches
    || ('standalone' in navigator && navigator.standalone === true);
}

export function isInsideSoundPlus() { return insideSoundPlus; }

export function refreshInstallBtn() {
  const btn = document.getElementById('installAppBtn');
  if (!btn) return;
  if (isStandaloneDisplay()) {
    btn.textContent = t('install_btn_done');
    btn.classList.add('installed');
    btn.disabled = true;
  } else {
    btn.textContent = t('install_btn');
    btn.classList.remove('installed');
    btn.disabled = false;
  }
}

function showInfoModal(title, bodyHTML) {
  const titleEl = document.getElementById('installInfoTitle');
  const bodyEl = document.getElementById('installInfoBody');
  if (titleEl) titleEl.textContent = title;
  if (bodyEl) bodyEl.innerHTML = bodyHTML;
  openModal('installInfoModal');
}

async function doDirectPrompt() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  try {
    const { outcome } = await deferredInstallPrompt.userChoice;
    if (outcome === 'accepted') deferredInstallPrompt = null;
  } catch (e) { /* キャンセル等はそのまま閉じる */ }
}

function showFallbackGuide() {
  if (isIOSDevice) showInfoModal(t('install_ios_title'), t('install_ios_body'));
  else showInfoModal(t('install_generic_title'), t('install_generic_body'));
}

export async function onInstallAppClick() {
  // すでにインストール済み(スタンドアロン起動中)
  if (isStandaloneDisplay()) {
    showInfoModal(t('install_already_title'), '<p>' + t('install_already_body') + '</p>');
    return;
  }

  if (insideSoundPlus) {
    if (deferredInstallPrompt) {
      // 直接インストール可能な環境: 確認モーダルを挟む
      const titleEl = document.getElementById('installGateTitle');
      const bodyEl = document.getElementById('installGateBody');
      const proceedBtn = document.getElementById('installGateProceedBtn');
      if (titleEl) titleEl.textContent = t('install_gate_title');
      if (bodyEl) bodyEl.innerHTML = '<p>' + t('install_gate_body') + '</p>';
      if (proceedBtn) proceedBtn.textContent = t('install_gate_proceed');
      openModal('installGateModal');
    } else {
      // 直接インストール不可の環境: 案内の前に説明文を続けて表示する
      const body = '<p style="margin-bottom:10px">' + t('install_gate_body') + '</p>'
        + (isIOSDevice ? t('install_ios_body') : t('install_generic_body'));
      showInfoModal(isIOSDevice ? t('install_ios_title') : t('install_generic_title'), body);
    }
    return;
  }

  if (deferredInstallPrompt) {
    await doDirectPrompt();
    return;
  }

  showFallbackGuide();
}

export function initInstall() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    refreshInstallBtn();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    refreshInstallBtn();
  });

  window.addEventListener('namachu:enter-hostcontext', () => {
    insideSoundPlus = true;
    refreshInstallBtn();
  });

  document.getElementById('installAppBtn')?.addEventListener('click', () => { void onInstallAppClick(); });
  document.getElementById('installGateProceedBtn')?.addEventListener('click', () => {
    closeModal('installGateModal');
    void doDirectPrompt();
  });

  refreshInstallBtn();
}
