"use client";

import { useState } from "react";
import { readResult } from "../read-result";
import type { Period, Stats } from "../../db/stats";
import { won } from "../../db/store-plans";

const PERIODS: { value: Period; label: string }[] = [
  { value: 7, label: "7일" },
  { value: 30, label: "30일" },
  { value: 0, label: "전체" },
];

/** Reads as "12명 중 3명" rather than "25%" when the numbers are this small. */
function rate(part: number, whole: number) {
  if (whole <= 0) return "—";
  return `${Math.round((part / whole) * 1000) / 10}%`;
}

export default function StatsPanel({ initialStats, initialPeriod }: {
  initialStats: Stats;
  initialPeriod: Period;
}) {
  const [stats, setStats] = useState(initialStats);
  const [period, setPeriod] = useState(initialPeriod);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = async (next: Period) => {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/control/stats?period=${next}`);
      const result = await readResult<{ stats: Stats }>(response, "숫자를 불러오지 못했습니다.");
      setStats(result.stats);
      setPeriod(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "숫자를 불러오지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const peak = Math.max(1, ...stats.byDay.map((day) => day.count));

  return (
    <>
      <div className="control-list-head">
        <h2>숫자판</h2>
        <div className="stat-periods">
          {PERIODS.map((option) => (
            <button
              type="button"
              key={option.value}
              className={option.value === period ? "on" : ""}
              onClick={() => load(option.value)}
              disabled={busy}
            >{option.label}</button>
          ))}
        </div>
      </div>

      {error && <p className="action-error">{error}</p>}

      <div className="stat-grid">
        <div className="stat-tile">
          <span>주문</span>
          <b>{stats.orders.total}건</b>
          <small>진행 {stats.orders.open} · 완료 {stats.orders.completed} · 거절 {stats.orders.cancelled}</small>
        </div>
        <div className="stat-tile">
          <span>완료된 주문 매출</span>
          <b>{won(stats.orders.revenue)}</b>
          <small>게임 안 화폐 기준</small>
        </div>
        <div className="stat-tile">
          <span>샵 후기</span>
          <b>{stats.reviews.count > 0 ? `★ ${stats.reviews.rating.toFixed(1)}` : "—"}</b>
          <small>{stats.reviews.count}건</small>
        </div>
        <div className="stat-tile">
          <span>상점 구매</span>
          <b>{stats.store.requests}건</b>
          <small>전달 완료 {stats.store.handled} · {won(stats.store.revenue)}</small>
        </div>
      </div>

      <div className="stat-funnel">
        <h3>보고 나서 주문까지</h3>
        <div className="stat-funnel-rows">
          <div>
            <span>샵 페이지를 연 횟수</span>
            <b>{stats.funnel.shopViews}</b>
          </div>
          <div>
            <span>그중 실제 주문</span>
            <b>{stats.funnel.orders}</b>
            <em>{rate(stats.funnel.orders, stats.funnel.shopViews)}</em>
          </div>
          <div>
            <span>상점을 연 횟수</span>
            <b>{stats.funnel.storeViews}</b>
          </div>
          <div>
            <span>그중 구매 요청</span>
            <b>{stats.funnel.purchases}</b>
            <em>{rate(stats.funnel.purchases, stats.funnel.storeViews)}</em>
          </div>
        </div>
        <p className="field-help">
          조회수는 브라우저가 페이지를 다 띄운 뒤에 한 번씩 셉니다. 검색 로봇처럼 스크립트를
          돌리지 않는 접속은 빠지므로 클라우드플레어 숫자보다 작게 나옵니다. 누가 봤는지는
          남기지 않습니다.
        </p>
      </div>

      {stats.byDay.length > 0 && (
        <div className="stat-days">
          <h3>날짜별 주문</h3>
          <ol>
            {stats.byDay.map((day) => (
              <li key={day.day}>
                <span>{day.day.slice(5)}</span>
                <i style={{ width: `${(day.count / peak) * 100}%` }}/>
                <b>{day.count}</b>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="stat-table">
        <h3>샵별</h3>
        {stats.byShop.length === 0 ? (
          <p className="field-help">아직 샵이 없습니다.</p>
        ) : (
          <table>
            <thead>
              <tr><th>샵</th><th>주문</th><th>완료</th><th>거절</th><th>매출</th><th>별점</th></tr>
            </thead>
            <tbody>
              {stats.byShop.map((shop) => (
                <tr key={shop.slug}>
                  <td>{shop.name}</td>
                  <td>{shop.orders}</td>
                  <td>{shop.completed}</td>
                  <td>{shop.cancelled}</td>
                  <td className="stat-money">{won(shop.revenue)}</td>
                  <td>{shop.reviews > 0 ? `★ ${shop.rating.toFixed(1)} (${shop.reviews})` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {stats.byItem.length > 0 && (
        <div className="stat-table">
          <h3>상품별</h3>
          <table>
            <thead>
              <tr><th>상품</th><th>요청</th><th>전달 완료</th><th>매출</th></tr>
            </thead>
            <tbody>
              {stats.byItem.map((item) => (
                <tr key={item.name}>
                  <td>{item.name}</td>
                  <td>{item.requests}</td>
                  <td>{item.handled}</td>
                  <td className="stat-money">{won(item.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {stats.applications.waiting > 0 && (
        <p className="stat-note">
          읽지 않은 입점 신청이 <b>{stats.applications.waiting}건</b> 있습니다.
        </p>
      )}
    </>
  );
}
