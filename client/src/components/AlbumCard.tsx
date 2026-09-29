import type { Album } from '../types';

interface AlbumCardProps {
  album: Album;
  platformName: string;
  onOpen?: () => void;
}

export default function AlbumCard({ album, platformName, onOpen }: AlbumCardProps) {
  return (
    <div
      className="card card--clickable"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen?.(); } }}
    >
      <img
        className="card__cover"
        src={album.cover || ''}
        alt=""
        loading="lazy"
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }}
      />
      <p className="card__name">{album.name || '未知专辑'}</p>
      <p className="card__meta">
        <span className="card__src">{platformName}</span>
        {album.artist ? `${album.artist} · ` : ''}
        {album.publishYear ? `${album.publishYear} · ` : ''}
        {album.count ? `${album.count} 首` : ''}
      </p>
    </div>
  );
}
