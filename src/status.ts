import { readListenerState, stateFilePath } from './state.js';

export interface StatusOptions {
  readonly stateDir: string;
}

export interface ListenerStatus {
  readonly object: 'tyxter_cli_status';
  readonly state_dir: string;
  readonly state_file: string;
  readonly configured: boolean;
  readonly signing_secret: string | null;
  readonly cursor: string | null;
  readonly updated_at: string | null;
}

export async function readStatus(options: StatusOptions): Promise<ListenerStatus> {
  const state = await readListenerState(options.stateDir);
  return {
    object: 'tyxter_cli_status',
    state_dir: options.stateDir,
    state_file: stateFilePath(options.stateDir),
    configured: state !== null,
    signing_secret: state?.signingSecret ?? null,
    cursor: state?.cursor ?? null,
    updated_at: state?.updatedAt ?? null,
  };
}
