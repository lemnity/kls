const productions = [
  ['Ревизор', 'Пошивочный цех ждёт согласования ткани', 'risk'],
  ['Гроза', 'Следующая репетиция — 14 сентября', 'plan'],
  ['Чайка', 'Паспорт спектакля обновлён', 'plan'],
] as const;

export default function HomePage() {
  return <main className="shell"><aside><p className="eyebrow">ТЕАТР ЕВРОПА · УЧЕБНЫЙ КОНТУР</p><h1>Пульт<br />постановки</h1><nav><a href="#productions">Постановки</a><a href="#calendar">Репетиции</a><a href="#archive">Паспорт</a></nav></aside><section><header><p>Сегодня · 02 сентября</p><button type="button">Новая постановка</button></header><div className="headline"><span>Точка безопасности</span><strong>3 спектакля в работе</strong></div><div id="productions" className="cards">{productions.map(([title, detail, state]) => <article key={title}><i className={state} /><h2>{title}</h2><p>{detail}</p><small>{state === 'risk' ? 'Нужно решение' : 'По плану'}</small></article>)}</div></section></main>;
}
