// Fixtures tab: attack/defence ratings for every Premier League team, how they have
// moved over the season, and how hard each team's next six fixtures look.
//
// The ratings (0–10, higher = better):
//   1. Goals scored and conceded per game, 80% season to date + 20% last 6 games.
//   2. Home advantage is the same for every team: ±0.154 goals (home teams average
//      1.55 goals a game, away teams 1.25, over 16 seasons).
//   3. Attack = 0.07 + 3.58 × goals scored per game; defence = 10.58 − 4.28 × goals
//      conceded per game, clipped to 0–10. The scale was fitted to span the same
//      range as the old Defensive_Records spreadsheet formula.
//   4. A fixture's difficulty is the opponent's rating at the venue they play at: their
//      defence rating for your attackers, their attack rating for your defenders.
// Backtested over 16 seasons this predicted goals and clean sheets clearly better than
// the spreadsheet's last-6 / last-4-at-venue formula, which it replaced. Separate
// home and away form for each team did not carry over within a season, so it's gone.
// Before 6 games a rating is marked provisional.
//
// Loaded before app.js; uses its fetchApi/FPL_BASE_URL/loadPref/savePref at call time.

const RATING_FIXTURES_AHEAD = 6;
const RATING_MIN_GAMES = 2;      // below this there is no rating at all
const RATING_FULL_GAMES = 6;     // below this it's provisional
const HOME_BONUS_GOALS = 0.154;
const ATTACK_SCALE = { base: 0.07, perGoal: 3.58 };
const DEFENCE_SCALE = { base: 10.58, perGoal: 4.28 };

let ratingsData = null;          // { teams, byId, history, current, upcoming }
let ratingsLoadId = 0;
let ratingsTeamId = null;
let ratingsRankBy = 'att';

const clamp10 = v => Math.max(0, Math.min(10, v));
const mean = xs => xs.reduce((s, x) => s + x, 0) / xs.length;

// hist: the team's matches so far, oldest first: { gf, ga }. venue: where the rating is
// for, 'H' or 'A', which only shifts both ratings by the shared home advantage, or 'N'
// for the team's overall rating with no venue.
function formRating(hist, venue) {
    if (hist.length < RATING_MIN_GAMES) return null;
    const blend = key => 0.8 * mean(hist.map(m => m[key])) + 0.2 * mean(hist.slice(-6).map(m => m[key]));
    const bonus = venue === 'H' ? HOME_BONUS_GOALS : venue === 'A' ? -HOME_BONUS_GOALS : 0;
    return {
        att: clamp10(ATTACK_SCALE.base + ATTACK_SCALE.perGoal * (blend('gf') + bonus)),
        def: clamp10(DEFENCE_SCALE.base - DEFENCE_SCALE.perGoal * (blend('ga') - bonus)),
        provisional: hist.length < RATING_FULL_GAMES
    };
}

function buildRatings(bootstrap, fixtures) {
    const teams = bootstrap.teams.map(t => ({ id: t.id, code: t.code, short: t.short_name, name: t.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
    const byId = Object.fromEntries(teams.map(t => [t.id, t]));
    const hist = Object.fromEntries(teams.map(t => [t.id, []]));
    const history = Object.fromEntries(teams.map(t => [t.id, []]));

    const byKickoff = (a, b) => new Date(a.kickoff_time) - new Date(b.kickoff_time);
    const played = fixtures
        .filter(f => f.finished_provisional && f.team_h_score !== null && f.team_a_score !== null)
        .sort(byKickoff);

    for (const f of played) {
        const sides = [
            [f.team_h, 'H', f.team_h_score, f.team_a_score],
            [f.team_a, 'A', f.team_a_score, f.team_h_score]
        ];
        for (const [id, venue, scored, conceded] of sides) {
            hist[id].push({ venue, gf: scored, ga: conceded });
            // Ratings going into the team's next match, plotted at the gameweek just
            // played. A double gameweek keeps only the later value.
            const point = { gw: f.event, home: formRating(hist[id], 'H'), away: formRating(hist[id], 'A') };
            const series = history[id];
            if (series.length && series[series.length - 1].gw === f.event) series.pop();
            series.push(point);
        }
    }

    const current = Object.fromEntries(teams.map(t => [t.id, {
        N: formRating(hist[t.id], 'N'),
        H: formRating(hist[t.id], 'H'),
        A: formRating(hist[t.id], 'A'),
        played: hist[t.id].length,
        home: hist[t.id].filter(m => m.venue === 'H').length,
        away: hist[t.id].filter(m => m.venue === 'A').length
    }]));

    // Unscheduled (postponed, no gameweek yet) fixtures are left out.
    const remaining = fixtures.filter(f => !f.finished_provisional && f.event).sort(byKickoff);
    const upcoming = Object.fromEntries(teams.map(t => [t.id, remaining
        .filter(f => f.team_h === t.id || f.team_a === t.id)
        .slice(0, RATING_FIXTURES_AHEAD)
        .map(f => {
            const home = f.team_h === t.id;
            const opp = home ? f.team_a : f.team_h;
            // The opponent plays at the other venue, so use their rating for that venue.
            const oppRating = current[opp][home ? 'A' : 'H'];
            return {
                gw: f.event,
                home,
                opp,
                oppDef: oppRating ? oppRating.def : null,   // for my attackers
                oppAtt: oppRating ? oppRating.att : null    // for my defenders
            };
        })]));

    return { teams, byId, history, current, upcoming };
}

async function loadRatings() {
    const loadId = ++ratingsLoadId;
    const container = document.getElementById('fixturesContainer');
    try {
        const [bootstrap, fixtures] = await Promise.all([
            fetchApi(`${FPL_BASE_URL}/bootstrap-static/`),
            fetchApi(`${FPL_BASE_URL}/fixtures/`)
        ]);
        if (loadId !== ratingsLoadId) return;
        ratingsData = buildRatings(bootstrap, fixtures);
        const saved = loadPref('ratingsTeam', null, Number);
        if (!ratingsTeamId) ratingsTeamId = ratingsData.byId[saved] ? saved : ratingsData.teams[0].id;
        renderRatings();
    } catch (error) {
        if (loadId !== ratingsLoadId) return;
        console.error('Error loading ratings:', error);
        container.innerHTML = '<div class="error">Failed to load fixtures</div>';
    }
}

// ---------------------------------------------------------------------------
// Rendering

const fmt = v => v === null || v === undefined ? '–' : v.toFixed(1);

// Colour an opponent's rating green (weak opponent, easy game) -> yellow -> red (strong
// opponent, tough game). measure is which of their ratings it is: 'att' or 'def'.
// Limits are the 10th percentile, median and 90th percentile of these ratings over
// 2021/22–2025/26, so about 10% of fixtures are fully green and 10% fully red.
const DIFFICULTY_LIMITS = { att: [3.0, 5.1, 7.8], def: [1.8, 4.5, 6.8] };
const DIFFICULTY_COLOURS = [[99, 190, 123], [255, 235, 132], [248, 105, 107]];   // green, yellow, red
function difficultyColour(value, measure) {
    if (value === null) return ['#f5f5f5', '#888'];
    const [lo, mid, hi] = DIFFICULTY_LIMITS[measure];
    const [from, to, f] = value <= mid
        ? [0, 1, Math.max(0, (value - lo) / (mid - lo))]
        : [1, 2, Math.min(1, (value - mid) / (hi - mid))];
    const rgb = DIFFICULTY_COLOURS[from].map((c, j) => Math.round(c + (DIFFICULTY_COLOURS[to][j] - c) * f));
    return [`rgb(${rgb.join(',')})`, '#1a1a1a'];
}

function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function averageOf(list, key) {
    const vals = list.map(f => f[key]).filter(v => v !== null);
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
}

// Rank teams by average opponent rating over their next fixtures; 1 = easiest.
function easeRanking(key) {
    return ratingsData.teams
        .map(t => ({ team: t, avg: averageOf(ratingsData.upcoming[t.id], key) }))
        .filter(r => r.avg !== null)
        .sort((a, b) => a.avg - b.avg);
}

function renderRatings() {
    const container = document.getElementById('fixturesContainer');
    const { teams, byId, current, upcoming, history } = ratingsData;
    const team = byId[ratingsTeamId];
    const cur = current[team.id];
    const next = upcoming[team.id];
    const attRank = easeRanking('oppDef').findIndex(r => r.team.id === team.id) + 1;
    const defRank = easeRanking('oppAtt').findIndex(r => r.team.id === team.id) + 1;
    const provisional = (cur.H && cur.H.provisional) || (cur.A && cur.A.provisional);

    container.innerHTML = `
        <div class="card">
            <div class="card-title">All teams — next ${RATING_FIXTURES_AHEAD}</div>
            <div class="seg">
                <button class="seg-btn${ratingsRankBy === 'att' ? ' active' : ''}" data-rank="att">For attackers</button>
                <button class="seg-btn${ratingsRankBy === 'def' ? ' active' : ''}" data-rank="def">For defenders</button>
            </div>
            ${scatterPlot(ratingsRankBy)}
            <div class="card-subtitle">Easiest first</div>
            ${rankingTable(ratingsRankBy === 'att' ? 'oppDef' : 'oppAtt', ratingsRankBy === 'att' ? 'def' : 'att')}
        </div>

        <select id="ratingsTeamSelect" class="team-select" aria-label="Team">
            ${teams.map(t => `<option value="${t.id}"${t.id === team.id ? ' selected' : ''}>${t.name}</option>`).join('')}
        </select>

        <div class="card">
            <div class="card-title">${team.name} — current ratings <span class="muted">(0–10, higher = better)</span></div>
            <div class="rating-tiles">
                ${ratingTile('Attack', 'home', cur.H && cur.H.att)}
                ${ratingTile('Attack', 'away', cur.A && cur.A.att)}
                ${ratingTile('Defence', 'home', cur.H && cur.H.def)}
                ${ratingTile('Defence', 'away', cur.A && cur.A.def)}
            </div>
            ${provisional ? `<div class="note">Provisional: based on ${cur.played} game${cur.played === 1 ? '' : 's'}. Ratings settle after about 6.</div>` : ''}
        </div>

        <div class="card">
            <div class="card-title">Next ${next.length} fixtures <span class="muted">(opponent's rating at their venue)</span></div>
            ${next.length ? `
            <table class="fixture-table">
                <thead><tr><th>GW</th><th>Opponent</th><th>Their defence<br><span class="muted">for your attackers</span></th><th>Their attack<br><span class="muted">for your defenders</span></th></tr></thead>
                <tbody>
                    ${next.map(f => `<tr>
                        <td class="gw">${f.gw}</td>
                        <td>${byId[f.opp].name} <span class="muted">(${f.home ? 'H' : 'A'})</span></td>
                        ${difficultyCell(f.oppDef, 'def')}
                        ${difficultyCell(f.oppAtt, 'att')}
                    </tr>`).join('')}
                </tbody>
                <tfoot><tr>
                    <td></td><td>Average</td>
                    ${difficultyCell(averageOf(next, 'oppDef'), 'def', attRank ? `${ordinal(attRank)} easiest` : '')}
                    ${difficultyCell(averageOf(next, 'oppAtt'), 'att', defRank ? `${ordinal(defRank)} easiest` : '')}
                </tr></tfoot>
            </table>
            <div class="scale-key"><span class="key-swatch" style="background:${difficultyColour(0, 'def')[0]}"></span>Easy
                <span class="key-swatch" style="background:${difficultyColour(DIFFICULTY_LIMITS.def[1], 'def')[0]}"></span>Average
                <span class="key-swatch" style="background:${difficultyColour(10, 'def')[0]}"></span>Hard</div>
            ` : '<div class="note">No fixtures scheduled.</div>'}
        </div>

        <div class="card">
            <div class="card-title">Ratings over the season <span class="muted">(after each gameweek)</span></div>
            <div class="chart-legend">
                <span><span class="legend-line" style="background:var(--series-home)"></span>Home</span>
                <span><span class="legend-line" style="background:var(--series-away)"></span>Away</span>
                <span><span class="legend-line legend-provisional"></span>Provisional</span>
            </div>
            <div class="chart-pair">
                <div class="chart-wrap" data-measure="att"><div class="chart-label">Attack</div>${lineChart(history[team.id], 'att')}</div>
                <div class="chart-wrap" data-measure="def"><div class="chart-label">Defence</div>${lineChart(history[team.id], 'def')}</div>
            </div>
        </div>

    `;

    container.querySelector('#ratingsTeamSelect').addEventListener('change', e => selectRatingsTeam(Number(e.target.value)));
    container.querySelectorAll('.seg-btn').forEach(btn => btn.addEventListener('click', () => {
        ratingsRankBy = btn.dataset.rank;
        renderRatings();
    }));
    // The all-teams views sit above the team picker, so picking from them scrolls down to
    // that team's detail.
    const showDetail = id => {
        selectRatingsTeam(id);
        container.querySelector('#ratingsTeamSelect').scrollIntoView({ behavior: 'smooth' });
    };
    container.querySelectorAll('.rank-row').forEach(row => row.addEventListener('click', () => showDetail(Number(row.dataset.team))));
    container.querySelectorAll('.chart-wrap').forEach(wrap => attachChartHover(wrap, history[team.id], wrap.dataset.measure));
    container.querySelectorAll('.scatter-dot').forEach(dot => dot.addEventListener('click', () => showDetail(Number(dot.dataset.team))));
}

function selectRatingsTeam(id) {
    ratingsTeamId = id;
    savePref('ratingsTeam', id);
    renderRatings();
}

function ratingTile(measure, venue, value) {
    return `<div class="rating-tile"><div class="tile-label">${measure} <span class="muted">${venue}</span></div><div class="tile-value">${fmt(value)}</div></div>`;
}

function difficultyCell(value, measure, sub) {
    const [bg, fg] = difficultyColour(value, measure);
    return `<td class="diff" style="background:${bg};color:${fg}">${fmt(value)}${sub ? `<div class="diff-sub">${sub}</div>` : ''}</td>`;
}

function rankingTable(key, measure) {
    const { byId, upcoming } = ratingsData;
    return `<table class="rank-table"><tbody>
        ${easeRanking(key).map((r, i) => `<tr class="rank-row${r.team.id === ratingsTeamId ? ' selected' : ''}" data-team="${r.team.id}">
            <td class="rank-pos">${i + 1}</td>
            <td class="rank-team">${r.team.short}</td>
            ${upcoming[r.team.id].map(f => {
                const [bg, fg] = difficultyColour(f[key], measure);
                const opp = byId[f.opp].short;
                return `<td class="rank-fix" style="background:${bg};color:${fg}" title="GW${f.gw} ${byId[f.opp].name} (${f.home ? 'H' : 'A'}) ${fmt(f[key])}">${f.home ? opp : opp.toLowerCase()}</td>`;
            }).join('')}
            ${'<td class="rank-fix"></td>'.repeat(RATING_FIXTURES_AHEAD - upcoming[r.team.id].length)}
            <td class="rank-avg">${fmt(r.avg)}</td>
        </tr>`).join('')}
    </tbody></table>
    <div class="note">Capitals = home, lower case = away. Tap a team to see its detail below.</div>`;
}

// ---------------------------------------------------------------------------
// Scatter: every team's own rating (overall, no venue) against the average rating of
// its next six opponents, drawn as club badges. For attackers that's attack vs
// opponents' defence; for defenders, defence vs opponents' attack. The y axis runs
// from tough fixtures at the bottom to easy at the top, so top right is best. Dashed
// lines at the league medians split it into quadrants.

const SCATTER = { w: 340, h: 270, left: 30, right: 12, top: 14, bottom: 32 };
const BADGE = 18, BADGE_SELECTED = 24;
// The Premier League's own badge images, keyed by FPL's team `code` (not its id).
const badgeUrl = code => `https://resources.premierleague.com/premierleague/badges/70/t${code}.png`;

function scatterPlot(measure) {
    const { teams, current, upcoming } = ratingsData;
    const oppKey = measure === 'att' ? 'oppDef' : 'oppAtt';
    const pts = teams
        .map(t => ({ t, x: current[t.id].N ? current[t.id].N[measure] : null, y: averageOf(upcoming[t.id], oppKey) }))
        .filter(p => p.x !== null && p.y !== null);
    if (pts.length < 2) return '<div class="note">Not enough games yet.</div>';

    const { w, h, left, right, top, bottom } = SCATTER;
    const range = vals => {
        const lo = Math.max(0, Math.floor(Math.min(...vals) - 0.5)), hi = Math.min(10, Math.ceil(Math.max(...vals) + 0.5));
        return [lo, Math.max(hi, lo + 2)];
    };
    const [x0, x1] = range(pts.map(p => p.x)), [y0, y1] = range(pts.map(p => p.y));
    const x = v => left + (v - x0) / (x1 - x0) * (w - left - right);
    const y = v => top + (v - y0) / (y1 - y0) * (h - top - bottom);    // low opponent rating (easy) at the top
    const ticks = (lo, hi) => { const step = hi - lo > 6 ? 2 : 1; const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v); return out; };
    const median = vals => { const s = [...vals].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
    const mx = median(pts.map(p => p.x)), my = median(pts.map(p => p.y));

    const own = measure === 'att' ? 'attack' : 'defence';
    const xName = measure === 'att' ? 'Attack rating' : 'Defence rating';
    const yName = measure === 'att' ? "Next 6 opponents' defence" : "Next 6 opponents' attack";
    // Selected team last, so its badge sits on top of any neighbour it overlaps.
    const ordered = [...pts].sort((a, b) => (a.t.id === ratingsTeamId) - (b.t.id === ratingsTeamId));
    return `<div class="scatter-wrap"><svg viewBox="0 0 ${w} ${h}" class="scatter" role="img"
        aria-label="${xName} against ${yName.toLowerCase()} for every team">
        ${ticks(x0, x1).map(v => `<line class="grid" x1="${x(v)}" x2="${x(v)}" y1="${top}" y2="${h - bottom}"/>
            <text class="tick" x="${x(v)}" y="${h - bottom + 11}" text-anchor="middle">${v}</text>`).join('')}
        ${ticks(y0, y1).map(v => `<line class="grid" x1="${left}" x2="${w - right}" y1="${y(v)}" y2="${y(v)}"/>
            <text class="tick" x="${left - 5}" y="${y(v) + 3}" text-anchor="end">${v}</text>`).join('')}
        <line class="median" x1="${x(mx)}" x2="${x(mx)}" y1="${top}" y2="${h - bottom}"/>
        <line class="median" x1="${left}" x2="${w - right}" y1="${y(my)}" y2="${y(my)}"/>
        <text class="quadrant" x="${w - right - 3}" y="${top + 9}" text-anchor="end">Strong ${own}, easy fixtures</text>
        <text class="quadrant" x="${left + 3}" y="${h - bottom - 4}">Weak ${own}, tough fixtures</text>
        <text class="axis-label" x="${(left + w - right) / 2}" y="${h - 3}" text-anchor="middle">${xName} (overall) → stronger</text>
        <text class="axis-label" transform="translate(9 ${(top + h - bottom) / 2}) rotate(-90)" text-anchor="middle">${yName} → easier</text>
        ${ordered.map(p => {
            // The selected team is marked by a larger badge with a ring; no text label, which
            // would land on a neighbour's badge in a crowded spot.
            const sel = p.t.id === ratingsTeamId, cx = x(p.x), cy = y(p.y), size = sel ? BADGE_SELECTED : BADGE;
            return `<g class="scatter-dot${sel ? ' selected' : ''}" data-team="${p.t.id}">
                <title>${p.t.name}: ${xName.toLowerCase()} ${fmt(p.x)}, ${yName.toLowerCase()} ${fmt(p.y)}</title>
                <circle class="badge-bg" cx="${cx}" cy="${cy}" r="${size / 2 + 1.5}"/>
                <image href="${badgeUrl(p.t.code)}" x="${cx - size / 2 + 2}" y="${cy - size / 2 + 2}" width="${size - 4}" height="${size - 4}"/>
                <circle class="hit" cx="${cx}" cy="${cy}" r="${Math.max(12, size / 2 + 2)}"/>
            </g>`;
        }).join('')}
    </svg></div>
    <div class="note">Top right is best. Dashed lines are the league medians. Tap a badge to see that team's detail below.</div>`;
}

// ---------------------------------------------------------------------------
// Line chart: one measure, home and away series, over gameweeks. With one shared home
// advantage the two lines run parallel. Plain SVG, sized by viewBox so it scales to its
// column. Provisional stretches are drawn dashed.

const CHART = { w: 170, h: 120, left: 18, right: 6, top: 6, bottom: 16 };

function chartScales(history) {
    const gws = history.map(p => p.gw);
    const minGw = Math.min(...gws), maxGw = Math.max(...gws);
    const x = gw => CHART.left + (maxGw === minGw ? 0.5 : (gw - minGw) / (maxGw - minGw)) * (CHART.w - CHART.left - CHART.right);
    const y = v => CHART.top + (1 - v / 10) * (CHART.h - CHART.top - CHART.bottom);
    return { x, y, minGw, maxGw };
}

function lineChart(history, measure) {
    const points = history.filter(p => p.home || p.away);
    if (points.length === 0) return '<div class="note">Not enough games yet.</div>';
    const { x, y, minGw, maxGw } = chartScales(points);
    const grid = [0, 5, 10].map(v => `
        <line x1="${CHART.left}" x2="${CHART.w - CHART.right}" y1="${y(v)}" y2="${y(v)}" class="grid"/>
        <text x="${CHART.left - 4}" y="${y(v) + 3}" class="tick" text-anchor="end">${v}</text>`).join('');
    const xTicks = [...new Set([minGw, Math.round((minGw + maxGw) / 2), maxGw])].map(gw =>
        `<text x="${x(gw)}" y="${CHART.h - 4}" class="tick" text-anchor="middle">${gw}</text>`).join('');

    const series = (key, cls) => {
        // Split into runs so provisional segments can be dashed; each segment takes the
        // provisional style of its later point.
        let out = '';
        for (let i = 1; i < points.length; i++) {
            const a = points[i - 1][key], b = points[i][key];
            if (!a || !b) continue;
            out += `<line x1="${x(points[i - 1].gw)}" y1="${y(a[measure])}" x2="${x(points[i].gw)}" y2="${y(b[measure])}" class="${cls}${b.provisional ? ' provisional' : ''}"/>`;
        }
        const last = [...points].reverse().find(p => p[key]);
        if (last) out += `<circle cx="${x(last.gw)}" cy="${y(last[key][measure])}" r="3.5" class="${cls}-dot"/>`;
        return out;
    };

    return `<svg viewBox="0 0 ${CHART.w} ${CHART.h}" class="line-chart" role="img"
        aria-label="${measure === 'att' ? 'Attack' : 'Defence'} rating by gameweek, home and away">
        ${grid}${xTicks}
        <line class="crosshair" y1="${CHART.top}" y2="${CHART.h - CHART.bottom}" visibility="hidden"/>
        ${series('home', 'home-line')}${series('away', 'away-line')}
    </svg><div class="chart-tip" hidden></div>`;
}

// Tap or hover a chart to read the values at the nearest gameweek.
function attachChartHover(wrap, history, measure) {
    const svg = wrap.querySelector('svg');
    const tip = wrap.querySelector('.chart-tip');
    if (!svg) return;
    const points = history.filter(p => p.home || p.away);
    const { x } = chartScales(points);
    const crosshair = svg.querySelector('.crosshair');

    const show = clientX => {
        const box = svg.getBoundingClientRect();
        const vx = (clientX - box.left) / box.width * CHART.w;
        const nearest = points.reduce((best, p) => Math.abs(x(p.gw) - vx) < Math.abs(x(best.gw) - vx) ? p : best);
        const cx = x(nearest.gw);
        crosshair.setAttribute('x1', cx);
        crosshair.setAttribute('x2', cx);
        crosshair.setAttribute('visibility', 'visible');
        tip.innerHTML = `<b>After GW${nearest.gw}</b><br>
            <span class="legend-line" style="background:var(--series-home)"></span>Home ${fmt(nearest.home && nearest.home[measure])}
            <span class="legend-line" style="background:var(--series-away)"></span>Away ${fmt(nearest.away && nearest.away[measure])}`;
        tip.hidden = false;
        const left = cx / CHART.w * box.width;
        tip.style.left = `${Math.min(Math.max(left, 40), box.width - 40)}px`;
    };
    const hide = () => { crosshair.setAttribute('visibility', 'hidden'); tip.hidden = true; };

    svg.addEventListener('pointermove', e => show(e.clientX));
    svg.addEventListener('pointerdown', e => show(e.clientX));
    svg.addEventListener('pointerleave', hide);
}
