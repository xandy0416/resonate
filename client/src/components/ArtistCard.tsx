import type { Artist } from '../types';

interface ArtistCardProps {
  artist: Artist;
  platformName: string;
  onOpen?: () => void;
}

export default function ArtistCard({ artist, platformName, onOpen }: ArtistCardProps) {
  return (
    <div
      className="card card--clickable"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen?.(); } }}
    >
      <img
        className="card__cover card__cover--round"
        src={artist.avatar || ''}
        alt=""
        loading="lazy"
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }}
      />
      <p className="card__name">{artist.name || '未知歌手'}</p>
      <p className="card__meta">
        <span className="card__src">{platformName}</span>
        {artist.alias ? `${artist.alias} · ` : ''}
        {artist.songCount ? `${artist.songCount} 首` : ''}
      </p>
    </div>
  );
}
