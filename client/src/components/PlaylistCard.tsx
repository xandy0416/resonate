import type { Playlist } from '../types';

interface PlaylistCardProps {
  playlist: Playlist;
  platformName: string;
  onOpen: () => void;
}

export default function PlaylistCard({ playlist, platformName, onOpen }: PlaylistCardProps) {
  return (
    <button type="button" className="card" onClick={onOpen}>
      <img
        className="card__cover"
        src={playlist.cover || ''}
        alt=""
        loading="lazy"
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }}
      />
      <p className="card__name">{playlist.name || '未命名歌单'}</p>
      <p className="card__meta">
        <span className="card__src">{platformName}</span>
        {playlist.owner ? playlist.owner : '未知创建者'}
        {playlist.count ? ` · ${playlist.count} 首` : ''}
      </p>
    </button>
  );
}
