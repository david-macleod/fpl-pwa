// Fixtures tab: attack/defence form ratings for every Premier League team, how they
// have moved over the season, and how hard each team's next six fixtures look.
//
// The ratings are the ones from the old Defensive_Records spreadsheet:
//   1. Every match scores 0/1/2 for attack (goals scored: 0, 1, 2+) and for defence
//      (goals conceded: 2+, 1, clean sheet).
//   2. Home rating = ½ × (scores from the last 4 home games + scores from the last 6
//      games anywhere). Away rating likewise with the last 4 away games. Range 0–10.
//   3. A fixture's difficulty is the opponent's rating at the venue they play at: their
//      defence rating for your attackers, their attack rating for your defenders.
// Early in the season, before a team has 6 games and 4 at the venue, the windows are
// scaled up from the games they have (e.g. 3 home games count ×4/3). Backtested over
// 16 seasons that is about as predictive as the full formula from 6 games on, and
// weak before 4, so those points are marked provisional.
//
// Loaded before app.js; uses its fetchApi/FPL_BASE_URL/loadPref/savePref at call time.

const RATING_FIXTURES_AHEAD = 6;
const RATING_MIN_GAMES = 2;      // below this there is no rating at all
const RATING_FULL_GAMES = 6;     // below this (or < 4 at the venue) it's provisional

let ratingsData = null;          // { teams, byId, history, current, upcoming }
let ratingsLoadId = 0;
let ratingsTeamId = null;
let ratingsRankBy = 'att';

const attackPoints = goals => Math.min(goals, 2);
const defencePoints = conceded => conceded === 0 ? 2 : conceded === 1 ? 1 : 0;

// hist: the team's matches so far, oldest first: { venue: 'H'|'A', a, d }
function formRating(hist, venue) {
    const last6 = hist.slice(-6);
    const atVenue = hist.filter(m => m.venue === venue).slice(-4);
    if (last6.length < RATING_MIN_GAMES || atVenue.length === 0) return null;
    const sum = (ms, key) => ms.reduce((s, m) => s + m[key], 0);
    const scaled = (ms, key, n) => sum(ms, key) * n / ms.length;
    return {
        att: 0.5 * (scaled(atVenue, 'a', 4) + scaled(last6, 'a', 6)),
        def: 0.5 * (scaled(atVenue, 'd', 4) + scaled(last6, 'd', 6)),
        provisional: last6.length < RATING_FULL_GAMES || atVenue.length < 4
    };
}

function buildRatings(bootstrap, fixtures) {
    const teams = bootstrap.teams.map(t => ({ id: t.id, short: t.short_name, name: t.name }))
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
            hist[id].push({ venue, a: attackPoints(scored), d: defencePoints(conceded) });
            // Ratings going into the team's next match, plotted at the gameweek just
            // played. A double gameweek keeps only the later value.
            const point = { gw: f.event, home: formRating(hist[id], 'H'), away: formRating(hist[id], 'A') };
            const series = history[id];
            if (series.length && series[series.length - 1].gw === f.event) series.pop();
            series.push(point);
        }
    }

    const current = Object.fromEntries(teams.map(t => [t.id, {
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

const fmt = v => v === null || v === undefined ? '–' : (Math.round(v * 2) / 2).toFixed(1);

// Mean of every team's current rating for a measure, used as the neutral midpoint of
// the easy↔hard colour scale so "average opponent" reads grey.
function leagueMean(key) {
    const vals = [];
    for (const c of Object.values(ratingsData.current)) {
        for (const v of ['H', 'A']) if (c[v]) vals.push(c[v][key]);
    }
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 5;
}

// Diverging scale: low opponent rating = easy (blue), high = hard (red), league
// average = neutral grey. Returns [background, text colour].
const EASY = [[205, 226, 251], [134, 182, 239], [42, 120, 214]];   // blue 100/250/450
const HARD = [[251, 216, 214], [240, 150, 148], [208, 59, 59]];
const NEUTRAL = [240, 239, 236];
function difficultyColour(value, mid) {
    if (value === null) return ['#f5f5f5', '#888'];
    const t = Math.max(-1, Math.min(1, (value - mid) / 4));   // ±4 rating points = full strength
    const ramp = t < 0 ? EASY : HARD;
    const k = Math.abs(t);
    const stops = [NEUTRAL, ...ramp];
    const pos = k * (stops.length - 1);
    const i = Math.min(Math.floor(pos), stops.length - 2);
    const f = pos - i;
    const rgb = stops[i].map((c, j) => Math.round(c + (stops[i + 1][j] - c) * f));
    const lum = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
    return [`rgb(${rgb.join(',')})`, lum < 0.55 ? '#fff' : '#1a1a1a'];
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
    const midDef = leagueMean('def');
    const midAtt = leagueMean('att');
    const attRank = easeRanking('oppDef').findIndex(r => r.team.id === team.id) + 1;
    const defRank = easeRanking('oppAtt').findIndex(r => r.team.id === team.id) + 1;
    const provisional = (cur.H && cur.H.provisional) || (cur.A && cur.A.provisional);

    container.innerHTML = `
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
            ${provisional ? `<div class="note">Provisional: ${cur.home} home and ${cur.away} away games so far. The full formula needs 6 games including 4 home and 4 away; until then the windows are scaled up from the games played.</div>` : ''}
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
                        ${difficultyCell(f.oppDef, midDef)}
                        ${difficultyCell(f.oppAtt, midAtt)}
                    </tr>`).join('')}
                </tbody>
                <tfoot><tr>
                    <td></td><td>Average</td>
                    ${difficultyCell(averageOf(next, 'oppDef'), midDef, attRank ? `${ordinal(attRank)} easiest` : '')}
                    ${difficultyCell(averageOf(next, 'oppAtt'), midAtt, defRank ? `${ordinal(defRank)} easiest` : '')}
                </tr></tfoot>
            </table>
            <div class="scale-key"><span class="key-swatch" style="background:${difficultyColour(midDef - 4, midDef)[0]}"></span>Easy
                <span class="key-swatch" style="background:${difficultyColour(midDef, midDef)[0]}"></span>Average
                <span class="key-swatch" style="background:${difficultyColour(midDef + 4, midDef)[0]}"></span>Hard</div>
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

        <div class="card">
            <div class="card-title">All teams — next ${RATING_FIXTURES_AHEAD}, easiest first</div>
            <div class="seg">
                <button class="seg-btn${ratingsRankBy === 'att' ? ' active' : ''}" data-rank="att">For attackers</button>
                <button class="seg-btn${ratingsRankBy === 'def' ? ' active' : ''}" data-rank="def">For defenders</button>
            </div>
            ${rankingTable(ratingsRankBy === 'att' ? 'oppDef' : 'oppAtt', ratingsRankBy === 'att' ? midDef : midAtt)}
        </div>
    `;

    container.querySelector('#ratingsTeamSelect').addEventListener('change', e => selectRatingsTeam(Number(e.target.value)));
    container.querySelectorAll('.seg-btn').forEach(btn => btn.addEventListener('click', () => {
        ratingsRankBy = btn.dataset.rank;
        renderRatings();
    }));
    container.querySelectorAll('.rank-row').forEach(row => row.addEventListener('click', () => {
        selectRatingsTeam(Number(row.dataset.team));
        container.scrollIntoView({ behavior: 'smooth' });
    }));
    container.querySelectorAll('.chart-wrap').forEach(wrap => attachChartHover(wrap, history[team.id], wrap.dataset.measure));
}

function selectRatingsTeam(id) {
    ratingsTeamId = id;
    savePref('ratingsTeam', id);
    renderRatings();
}

function ratingTile(measure, venue, value) {
    return `<div class="rating-tile"><div class="tile-label">${measure} <span class="muted">${venue}</span></div><div class="tile-value">${fmt(value)}</div></div>`;
}

function difficultyCell(value, mid, sub) {
    const [bg, fg] = difficultyColour(value, mid);
    return `<td class="diff" style="background:${bg};color:${fg}">${fmt(value)}${sub ? `<div class="diff-sub">${sub}</div>` : ''}</td>`;
}

function rankingTable(key, mid) {
    const { byId, upcoming } = ratingsData;
    return `<table class="rank-table"><tbody>
        ${easeRanking(key).map((r, i) => `<tr class="rank-row${r.team.id === ratingsTeamId ? ' selected' : ''}" data-team="${r.team.id}">
            <td class="rank-pos">${i + 1}</td>
            <td class="rank-team">${r.team.short}</td>
            ${upcoming[r.team.id].map(f => {
                const [bg, fg] = difficultyColour(f[key], mid);
                const opp = byId[f.opp].short;
                return `<td class="rank-fix" style="background:${bg};color:${fg}" title="GW${f.gw} ${byId[f.opp].name} (${f.home ? 'H' : 'A'}) ${fmt(f[key])}">${f.home ? opp : opp.toLowerCase()}</td>`;
            }).join('')}
            ${'<td class="rank-fix"></td>'.repeat(RATING_FIXTURES_AHEAD - upcoming[r.team.id].length)}
            <td class="rank-avg">${fmt(r.avg)}</td>
        </tr>`).join('')}
    </tbody></table>
    <div class="note">Capitals = home, lower case = away. Tap a team to see its detail above.</div>`;
}

// ---------------------------------------------------------------------------
// Line chart: one measure, home and away series, over gameweeks. Plain SVG, sized by
// viewBox so it scales to its column. Provisional stretches are drawn dashed.

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
