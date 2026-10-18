import TransferManagerView from './TransferManagerView';

export default function DownloadManager({ onBack }: { onBack: () => void }) {
  return <TransferManagerView direction="download" onBack={onBack} />;
}
