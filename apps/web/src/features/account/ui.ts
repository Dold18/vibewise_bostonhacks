/**
 * The top-right account control: a button that opens a small popover with
 * either the sign-in / create-account form or the signed-in account panel.
 * Built once; state changes update it in place so typed input survives.
 */
import type { AccountState, AccountStore } from './session';
import { VIBE_LABELS } from './vibes';
import './account.css';

type Mode = 'sign_in' | 'sign_up';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

export function mountAccountUi(container: HTMLElement, store: AccountStore): () => void {
  let open = false;
  let mode: Mode = 'sign_in';
  let busy = false;
  let confirmingClear = false;

  const button = el('button', { type: 'button', className: 'account-btn' });
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-expanded', 'false');

  const popover = el('div', { className: 'account-popover', hidden: true });
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-label', 'Account');

  // --- Signed out: sign-in / create-account form ---
  const formTitle = el('h2', { className: 'account-title' });
  const email = el('input', { type: 'email', name: 'email', required: true, autocomplete: 'email', placeholder: 'you@school.edu' });
  const password = el('input', { type: 'password', name: 'password', required: true, minLength: 6 });
  const submit = el('button', { type: 'submit', className: 'account-primary' });
  const formError = el('p', { className: 'account-error', hidden: true });
  formError.setAttribute('role', 'alert');
  const notice = el('p', { className: 'account-notice', hidden: true }, 'Check your email to confirm');
  notice.setAttribute('role', 'status');
  const switchMode = el('button', { type: 'button', className: 'account-link' });
  const form = el(
    'form',
    { className: 'account-form', noValidate: false },
    formTitle,
    el('label', { className: 'account-field' }, el('span', {}, 'Email'), email),
    el('label', { className: 'account-field' }, el('span', {}, 'Password'), password),
    formError,
    notice,
    submit,
    switchMode,
  );

  // --- Signed in: account panel ---
  const who = el('p', { className: 'account-email' });
  const vibesHeading = el('h3', { className: 'account-subtitle' }, 'Your vibes');
  const sample = el('span', { className: 'account-badge', hidden: true }, 'Includes sample vibes');
  const chips = el('ul', { className: 'account-chips' });
  const empty = el('p', { className: 'account-empty' }, 'Your map will start to reflect your vibes as you explore.');
  const effectsToggle = el('input', { type: 'checkbox', className: 'account-switch' });
  effectsToggle.setAttribute('role', 'switch');
  const clearBtn = el('button', { type: 'button', className: 'account-secondary' }, 'Clear my vibe history');
  const confirmText = el('span', {}, "Clear all of it? This can't be undone.");
  const confirmYes = el('button', { type: 'button', className: 'account-danger' }, 'Clear');
  const confirmNo = el('button', { type: 'button', className: 'account-link' }, 'Cancel');
  const confirmRow = el('div', { className: 'account-confirm', hidden: true }, confirmText, confirmYes, confirmNo);
  const panelError = el('p', { className: 'account-error', hidden: true });
  panelError.setAttribute('role', 'alert');
  const signOutBtn = el('button', { type: 'button', className: 'account-secondary' }, 'Sign out');
  const panel = el(
    'div',
    { className: 'account-panel' },
    who,
    el('div', { className: 'account-vibes-head' }, vibesHeading, sample),
    chips,
    empty,
    el('label', { className: 'account-toggle' }, el('span', {}, 'Map effects'), effectsToggle),
    clearBtn,
    confirmRow,
    panelError,
    signOutBtn,
  );

  popover.append(form, panel);
  container.append(button, popover);

  function setOpen(next: boolean, focusButton = true) {
    if (open === next) return;
    open = next;
    popover.hidden = !next;
    button.setAttribute('aria-expanded', String(next));
    if (next) {
      const first = store.getState().status === 'signed_in' ? effectsToggle : email;
      first.focus();
    } else {
      confirmingClear = false;
      if (focusButton) button.focus();
    }
    render(store.getState());
  }

  /** "Sign in" text, or (on phones, via CSS) a person icon so the search bar keeps its room. */
  function showSignInLabel() {
    if (button.querySelector('.account-btn-label')) return;
    button.innerHTML =
      '<svg class="account-btn-icon" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8m0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4" /></svg>' +
      '<span class="account-btn-label">Sign in</span>';
  }

  function render(state: AccountState) {
    const signedIn = state.status === 'signed_in';
    button.disabled = state.status === 'unavailable';
    button.classList.toggle('is-avatar', signedIn);
    if (state.status === 'unavailable') {
      showSignInLabel();
      button.title = 'Accounts unavailable';
      button.setAttribute('aria-label', 'Accounts unavailable');
      setOpen(false, false);
    } else if (signedIn) {
      button.textContent = (state.user.email[0] ?? '?').toUpperCase();
      button.title = state.user.email;
      button.setAttribute('aria-label', `Account: ${state.user.email}`);
    } else {
      showSignInLabel();
      button.removeAttribute('title');
      button.setAttribute('aria-label', 'Sign in');
    }
    button.setAttribute('aria-busy', String(state.status === 'loading'));

    form.hidden = signedIn;
    panel.hidden = !signedIn;

    if (!signedIn) {
      formTitle.textContent = mode === 'sign_in' ? 'Sign in' : 'Create account';
      submit.textContent = busy ? 'Please wait…' : mode === 'sign_in' ? 'Sign in' : 'Create account';
      submit.disabled = busy || state.status === 'loading';
      password.autocomplete = mode === 'sign_in' ? 'current-password' : 'new-password';
      switchMode.textContent = mode === 'sign_in' ? 'New here? Create account' : 'Have an account? Sign in';
      const error = state.status === 'signed_out' ? state.error : undefined;
      formError.hidden = !error;
      formError.textContent = error ?? '';
      notice.hidden = !(state.status === 'signed_out' && state.notice === 'confirm_email');
      return;
    }

    who.textContent = state.user.email;
    sample.hidden = !state.taste.hasSample;
    const top = state.taste.topVibes;
    chips.replaceChildren(
      ...top.map(({ key, score }) => {
        const bar = el('span', { className: 'account-chip-bar' });
        bar.style.width = `${Math.round(score * 100)}%`;
        const chip = el('li', { className: 'account-chip' }, el('span', {}, VIBE_LABELS[key]), el('span', { className: 'account-chip-track' }, bar));
        chip.title = `${Math.round(score * 100)}%`;
        return chip;
      }),
    );
    chips.hidden = top.length === 0;
    empty.hidden = top.length > 0;
    effectsToggle.checked = state.profile.effectsEnabled;
    effectsToggle.setAttribute('aria-checked', String(state.profile.effectsEnabled));
    clearBtn.hidden = confirmingClear;
    clearBtn.disabled = state.events.length === 0;
    confirmRow.hidden = !confirmingClear;
    panelError.hidden = !state.error;
    panelError.textContent = state.error ?? '';
  }

  // --- Events ---
  button.addEventListener('click', () => setOpen(!open));
  switchMode.addEventListener('click', () => {
    mode = mode === 'sign_in' ? 'sign_up' : 'sign_in';
    render(store.getState());
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    busy = true;
    render(store.getState());
    try {
      if (mode === 'sign_in') await store.signIn(email.value.trim(), password.value);
      else await store.signUp(email.value.trim(), password.value);
    } finally {
      busy = false;
      if (store.getState().status === 'signed_in') {
        password.value = '';
        effectsToggle.focus();
      }
      render(store.getState());
    }
  });
  effectsToggle.addEventListener('change', () => void store.setEffectsEnabled(effectsToggle.checked));
  clearBtn.addEventListener('click', () => {
    confirmingClear = true;
    render(store.getState());
    confirmNo.focus();
  });
  confirmNo.addEventListener('click', () => {
    confirmingClear = false;
    render(store.getState());
    clearBtn.focus();
  });
  confirmYes.addEventListener('click', async () => {
    confirmingClear = false;
    await store.clearHistory();
    render(store.getState());
    clearBtn.focus();
  });
  signOutBtn.addEventListener('click', async () => {
    await store.signOut();
    setOpen(false);
  });

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && open) setOpen(false);
  };
  const onPointer = (e: PointerEvent) => {
    const t = e.target as Node;
    if (open && !popover.contains(t) && !button.contains(t)) setOpen(false, false);
  };
  document.addEventListener('keydown', onKey);
  document.addEventListener('pointerdown', onPointer);
  const unsubscribe = store.subscribe(render);
  render(store.getState());

  return () => {
    unsubscribe();
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('pointerdown', onPointer);
    button.remove();
    popover.remove();
  };
}
