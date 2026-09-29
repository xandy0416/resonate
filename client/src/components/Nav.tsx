export default function Nav({ drawerOpen = false }: { drawerOpen?: boolean }) {
  return (
    <div className={drawerOpen ? 'app-top app-top--pushed' : 'app-top'}>
      <nav className="nav-pill" aria-label="主导航">
        <span className="wordmark">
          聚合音乐
          <span className="wordmark__kicker">Resonate</span>
        </span>
      </nav>
    </div>
  );
}
