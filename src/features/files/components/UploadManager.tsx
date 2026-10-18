import TransferManagerView from './TransferManagerView';

export default function UploadManager({ onBack }: { onBack: () => void }) {
  return <TransferManagerView direction="upload" onBack={onBack} />;
}
