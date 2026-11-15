// Puente con el núcleo Rust y el companion.
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface Reply {
  ev: 'reply';
  ok: boolean;
  result?: Json;
  error?: { key?: string; params?: Json; msg: string };
}

export interface CompanionState {
  running: boolean;
  status: Json;
  logs: Json[];
}

export const getConfig = () => invoke<Json>('get_config');
export const saveConfig = (config: Json) => invoke<Reply>('save_config', { config });
export const getState = () => invoke<CompanionState>('get_state');
export const restartCompanion = () => invoke<void>('restart_companion');
export const quitApp = () => invoke<void>('quit_app');
export const hideWindow = () => invoke<void>('hide_window');
export const appInfo = () => invoke<Json>('app_info');
export const openPath = (path: string) => invoke<void>('open_path', { path });

/** Comando al companion. Lanza si el companion no responde; devuelve el reply (ok o no). */
export const request = (cmd: string, args: Json = {}) => invoke<Reply>('companion_request', { cmd, args });

export const onCompanion = (fn: (ev: Json) => void) => listen<Json>('companion', (e) => fn(e.payload));
export const onState = (fn: (s: CompanionState) => void) => listen<CompanionState>('companion-state', (e) => fn(e.payload));
export const onCheckUpdates = (fn: () => void) => listen('check-updates', () => fn());
