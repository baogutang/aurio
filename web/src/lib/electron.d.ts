export {};

declare global {
  interface Window {
    aurio?: {
      releasesUrl?: string;
      updates?: {
        check: () => Promise<{
          ok: boolean;
          status?: string;
          version?: string;
          latestVersion?: string;
          updateAvailable?: boolean;
          detail?: string;
        }>;
        download: () => Promise<{ ok: boolean; status?: string; detail?: string }>;
        install: () => Promise<{ ok: boolean; status?: string; detail?: string }>;
        onEvent: (handler: (payload: {
          event?: string;
          progress?: { percent?: number };
          version?: string;
          message?: string;
        }) => void) => () => void;
      };
    };
  }
}
