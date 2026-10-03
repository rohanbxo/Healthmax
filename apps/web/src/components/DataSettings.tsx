/**
 * Export, import and delete account (SPEC.md §11 "Settings").
 *
 * The two destructive actions both ask first, and both say exactly what will
 * happen: an import replaces everything in the account, and deleting takes the
 * password, so a stolen access token alone cannot destroy someone's history
 * (SPEC.md §9).
 *
 * A cloud export leaves the file in the server's bucket and shows a
 * short-lived download link instead; a server without a bucket says so once
 * and the button stays off.
 */
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { type ImportBody, formatTime, importBodySchema, parseInstant } from '@beta/core';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  Button,
  Field,
  Input,
  SectionLabel,
  useToast,
} from '@/components/ui';
import {
  type CloudExportDTO,
  useCloudExport,
  useDeleteAccount,
  useExport,
  useImport,
  useMe,
} from '@/api/hooks';
import { useAuth } from '@/auth/AuthProvider';
import { LOGIN_PATH } from '@/auth/RequireAuth';

/**
 * Reads a chosen file as text. `FileReader` rather than `Blob.text()`: it is
 * the one API every browser and the test environment agree on.
 */
function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read.'));
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.readAsText(file);
  });
}

/** Hands the browser a file without a round trip through a server. */
function downloadJson(filename: string, data: unknown): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function DataSettings(): React.ReactElement {
  const exportData = useExport();
  const cloudExport = useCloudExport();
  const { data: me } = useMe();
  const importData = useImport();
  const deleteAccount = useDeleteAccount();
  const { signOut } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const fileInput = React.useRef<HTMLInputElement>(null);
  const [pending, setPending] = React.useState<ImportBody | null>(null);
  const [password, setPassword] = React.useState('');
  const [deleteError, setDeleteError] = React.useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [cloudLink, setCloudLink] = React.useState<CloudExportDTO | null>(null);
  const [cloudUnavailable, setCloudUnavailable] = React.useState(false);

  function handleCloudExport(): void {
    cloudExport.mutate(undefined, {
      onSuccess: (link) => setCloudLink(link),
      onError: (error) => {
        // Only a server without a bucket answers 404 here; asking again cannot help.
        if (error.code === 'NOT_FOUND') {
          setCloudLink(null);
          setCloudUnavailable(true);
          return;
        }
        toast({
          title: 'We could not save your export to the cloud.',
          description: error.message,
          variant: 'error',
        });
      },
    });
  }

  function handleExport(): void {
    exportData.mutate(undefined, {
      onSuccess: (data) => {
        downloadJson(`beta-export-${data.exportedAt.slice(0, 10)}.json`, data);
        toast({ title: 'Export downloaded.' });
      },
      onError: () => toast({ title: 'We could not build your export.', variant: 'error' }),
    });
  }

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    // Let the same file be chosen twice in a row.
    event.target.value = '';
    if (!file) return;

    try {
      const parsed = importBodySchema.safeParse(JSON.parse(await readText(file)));
      if (!parsed.success) {
        toast({ title: 'That file is not a Beta export.', variant: 'error' });
        return;
      }
      setPending(parsed.data);
    } catch {
      toast({ title: 'That file is not readable JSON.', variant: 'error' });
    }
  }

  function runImport(): void {
    if (pending === null) return;
    importData.mutate(pending, {
      onSuccess: (report) => {
        toast({ title: `Imported ${report.habits} habits and ${report.logs} logs.` });
        setPending(null);
      },
      onError: () => {
        toast({ title: 'We could not import that file.', variant: 'error' });
        setPending(null);
      },
    });
  }

  function runDelete(): void {
    setDeleteError(null);
    deleteAccount.mutate(
      { password },
      {
        onSuccess: () => {
          setConfirmDelete(false);
          signOut();
          navigate(LOGIN_PATH, { replace: true });
        },
        onError: (error) => {
          setDeleteError(
            error.status === 422
              ? 'That password is not right.'
              : 'We could not delete your account. Try again.',
          );
        },
      },
    );
  }

  return (
    <section className="flex flex-col gap-2" aria-label="Your data">
      <SectionLabel>YOUR DATA</SectionLabel>

      <Button variant="outline" fullWidth loading={exportData.isPending} onClick={handleExport}>
        Export my data
      </Button>

      <Button
        variant="outline"
        fullWidth
        disabled={cloudUnavailable}
        loading={cloudExport.isPending}
        onClick={handleCloudExport}
      >
        Save export to cloud
      </Button>

      {cloudUnavailable ? (
        <p role="status" className="text-sm text-muted">
          Cloud export is not configured.
        </p>
      ) : null}

      {cloudLink === null ? null : (
        <p role="status" className="flex items-baseline justify-between gap-3 text-sm">
          <a
            href={cloudLink.url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium underline underline-offset-2"
          >
            Download link
          </a>
          <span className="font-mono text-muted">
            {`Link expires at ${formatTime(parseInstant(cloudLink.expiresAt), me?.timeZone ?? 'UTC')}`}
          </span>
        </p>
      )}

      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        aria-label="Import file"
        onChange={(event) => void handleFile(event)}
      />
      <Button
        variant="outline"
        fullWidth
        loading={importData.isPending}
        onClick={() => fileInput.current?.click()}
      >
        Import from a file
      </Button>

      <Button variant="destructive" fullWidth onClick={() => setConfirmDelete(true)}>
        Delete my account
      </Button>

      {/* Import replaces everything, so it is confirmed like a delete. */}
      <AlertDialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent
          title="Replace everything?"
          description={
            pending === null
              ? ''
              : `This deletes every habit and log in your account and puts the file's ${pending.habits.length} habits and ${pending.logs.length} logs in their place. It cannot be undone.`
          }
        >
          <AlertDialogFooter>
            <AlertDialogCancel>Keep my data</AlertDialogCancel>
            <AlertDialogAction onClick={runImport}>Replace everything</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirmDelete}
        onOpenChange={(open) => {
          setConfirmDelete(open);
          if (!open) {
            setPassword('');
            setDeleteError(null);
          }
        }}
      >
        <AlertDialogContent
          title="Delete your account?"
          description="Every habit, log and reminder goes with it. This cannot be undone."
        >
          <Field label="Password" error={deleteError ?? undefined} required>
            <Input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep my account</AlertDialogCancel>
            <AlertDialogAction
              disabled={password === '' || deleteAccount.isPending}
              onClick={(event) => {
                // Radix closes the dialog on this click. A wrong password has
                // to leave it open, or the message lands on a dialog that is
                // no longer there; `runDelete` closes it once the delete works.
                event.preventDefault();
                runDelete();
              }}
            >
              Delete for ever
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
