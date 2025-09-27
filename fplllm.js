// FPLLLM - FPL Normal League Live Tracker adapted to look like H2H
const FPL_BASE_URL = 'https://fantasy.premierleague.com/api';
const PROXY_URL = 'https://corsproxy.io/?';

// Hardcoded Normal League
const LEAGUE_ID = 1549023;

let currentGW = null;
let gameweekData = null;
let fixturesData = {};
let liveData = null;
let teamsData = {};
let fakeMatches = [];

// DOM elements
const matchesContainer = document.getElementById('matchesContainer');
const loadingDiv = document.getElementById('loading');
const errorDiv = document.getElementById('error');
const gwInfoSpan = document.getElementById('gwInfo');
const refreshBtn = document.getElementById('refresh');

// Add loading states with dots animation
let loadingDotsInterval;

function startLoadingAnimation() {
    let dots = 0;
    loadingDiv.textContent = 'Loading';
    loadingDotsInterval = setInterval(() => {
        dots = (dots + 1) % 4;
        loadingDiv.textContent = 'Loading' + '.'.repeat(dots);
    }, 500);
}

function stopLoadingAnimation() {
    if (loadingDotsInterval) {
        clearInterval(loadingDotsInterval);
        loadingDotsInterval = null;
    }
}

async function fetchWithProxy(url) {
    const response = await fetch(PROXY_URL + encodeURIComponent(url));
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.json();
}

function showLoading() {
    startLoadingAnimation();
    loadingDiv.classList.remove('hidden');
    errorDiv.classList.add('hidden');
    matchesContainer.classList.add('hidden');
}

function hideLoading() {
    stopLoadingAnimation();
    loadingDiv.classList.add('hidden');
}

function showError(message) {
    stopLoadingAnimation();
    loadingDiv.classList.add('hidden');
    errorDiv.textContent = message;
    errorDiv.classList.remove('hidden');
    matchesContainer.classList.add('hidden');
}

async function loadData() {
    refreshBtn.disabled = true;
    refreshBtn.textContent = '⟳';
    
    try {
        showLoading();
        
        // Get current gameweek data
        const bootstrapData = await fetchWithProxy(`${FPL_BASE_URL}/bootstrap-static/`);
        gameweekData = bootstrapData.events.find(gw => gw.is_current);
        currentGW = gameweekData.id;
        
        gwInfoSpan.textContent = `GW${currentGW}`;
        
        // Get fixtures for current gameweek  
        const fixturesResponse = await fetchWithProxy(`${FPL_BASE_URL}/fixtures/?event=${currentGW}`);
        
        // Create lookup for team fixtures
        fixturesData = {};
        for (const fixture of fixturesResponse) {
            const homeTeam = bootstrapData.teams.find(t => t.id === fixture.team_h);
            const awayTeam = bootstrapData.teams.find(t => t.id === fixture.team_a);
            
            fixturesData[fixture.team_h] = {
                ...fixture,
                opponent: awayTeam?.short_name || 'TBD',
                isHome: true
            };
            fixturesData[fixture.team_a] = {
                ...fixture,
                opponent: homeTeam?.short_name || 'TBD',
                isHome: false
            };
        }
        
        // Get live data
        liveData = await fetchWithProxy(`${FPL_BASE_URL}/event/${currentGW}/live/`);
        
        // Get league standings
        const leagueData = await fetchWithProxy(`${FPL_BASE_URL}/leagues-classic/${LEAGUE_ID}/standings/`);
        const standings = leagueData.standings.results;
        
        // Create fake matches from teams
        fakeMatches = [];
        teamsData = {};
        
        // Process each team
        const teamPromises = standings.map(async (standing, index) => {
            const teamId = standing.entry;
            
            try {
                const teamData = await fetchWithProxy(`${FPL_BASE_URL}/entry/${teamId}/`);
                const pickData = await fetchWithProxy(`${FPL_BASE_URL}/entry/${teamId}/event/${currentGW}/picks/`);
                
                // Process players
                const players = pickData.picks.map(pick => {
                    const playerInfo = bootstrapData.elements.find(p => p.id === pick.element);
                    const liveStats = liveData.elements[pick.element - 1]?.stats || {};
                    
                    // Get fixture info for player's team
                    const fixtureInfo = playerInfo?.team ? fixturesData[playerInfo.team] : null;
                    
                    // Determine if player is "done" 
                    let playerDone = false;
                    let didntPlay = false;
                    let gameInProgress = false;
                    let bonusPending = false;
                    
                    if (fixtureInfo) {
                        const gameMinutes = fixtureInfo.minutes || 0;
                        const playerMinutes = liveStats.minutes || 0;
                        const hasRedCard = liveStats.red_cards > 0;
                        
                        gameInProgress = fixtureInfo.started && !fixtureInfo.finished_provisional;
                        bonusPending = fixtureInfo.finished_provisional && !fixtureInfo.finished && playerMinutes > 0;
                        
                        if (fixtureInfo.finished) {
                            playerDone = true;
                            didntPlay = playerMinutes === 0;
                        }
                        else if (fixtureInfo.finished_provisional) {
                            playerDone = true;
                            didntPlay = playerMinutes === 0;
                        }
                        else if (hasRedCard) {
                            playerDone = true;
                        }
                        else if (playerMinutes > 0 && playerMinutes < gameMinutes - 5 && liveStats.starts > 0) {
                            playerDone = true;
                        }
                    }
                    
                    const opponentTeam = fixtureInfo?.opponent || '';
                    const displayTeam = fixtureInfo?.isHome ? opponentTeam : opponentTeam.toLowerCase();
                    
                    // Generate event emojis
                    let eventEmojis = '';
                    if (liveStats.goals_scored > 0) {
                        eventEmojis += '⚽️'.repeat(liveStats.goals_scored);
                    }
                    if (liveStats.assists > 0) {
                        eventEmojis += '👟'.repeat(liveStats.assists);
                    }
                    if (liveStats.yellow_cards > 0) {
                        eventEmojis += '🟨'.repeat(liveStats.yellow_cards);
                    }
                    if (liveStats.red_cards > 0) {
                        eventEmojis += '🟥'.repeat(liveStats.red_cards);
                    }
                    if (liveStats.bonus > 0) {
                        eventEmojis += '🎁'.repeat(liveStats.bonus);
                    }
                    
                    return {
                        position: pick.position,
                        element: pick.element,
                        is_captain: pick.is_captain,
                        is_vice_captain: pick.is_vice_captain,
                        multiplier: pick.multiplier,
                        playerName: playerInfo?.web_name || 'Unknown',
                        playerPosition: getPositionName(playerInfo?.element_type),
                        teamId: playerInfo?.team,
                        points: liveStats.total_points || 0,
                        eventEmojis,
                        playerDone,
                        didntPlay,
                        gameInProgress,
                        bonusPending,
                        displayTeam,
                        fixtureStatus: getFixtureStatus(fixtureInfo)
                    };
                });
                
                // Sort into XI and bench
                const xi = players.filter(p => p.position <= 11).sort((a, b) => a.position - b.position);
                const bench = players.filter(p => p.position > 11).sort((a, b) => a.position - b.position);
                
                // Calculate auto subs
                const autoSubs = calculateAutoSubs(xi, bench);
                
                // Mark bench players who will come on
                bench.forEach(player => {
                    player.willComeOn = autoSubs.includes(player.position);
                });
                
                // Calculate total points
                let livePoints = 0;
                xi.forEach(player => {
                    if (!autoSubs.some(pos => bench.find(b => b.position === pos && xi.find(x => x.playerDone && x.didntPlay)))) {
                        livePoints += player.points * player.multiplier;
                    }
                });
                bench.forEach(player => {
                    if (autoSubs.includes(player.position)) {
                        livePoints += player.points;
                    }
                });
                
                teamsData[teamId] = {
                    id: teamId,
                    name: standing.entry_name,
                    manager: standing.player_name,
                    xi: xi,
                    bench: bench,
                    livePoints: livePoints,
                    transfersCost: 0
                };
                
            } catch (error) {
                console.error(`Error processing team ${standing.entry_name}:`, error);
                teamsData[teamId] = {
                    id: teamId,
                    name: standing.entry_name,
                    manager: standing.player_name,
                    xi: [],
                    bench: [],
                    livePoints: 0,
                    transfersCost: 0
                };
            }
        });
        
        await Promise.all(teamPromises);
        
        // Create fake matches (each team vs dummy opponent)
        const teamIds = Object.keys(teamsData);
        teamIds.forEach(teamId => {
            fakeMatches.push({
                team1: teamId,
                team2: 'dummy'  // We'll handle this in display
            });
        });
        
        displayMatches();
        hideLoading();
        
    } catch (error) {
        console.error('Error loading data:', error);
        showError(`Failed to load data: ${error.message}`);
    } finally {
        refreshBtn.textContent = '↻';
        refreshBtn.disabled = false;
    }
}

function getPositionName(elementType) {
    const positions = { 1: 'GKP', 2: 'DEF', 3: 'MID', 4: 'FWD' };
    return positions[elementType] || 'UNK';
}

function getFixtureStatus(fixtureInfo) {
    if (!fixtureInfo) return '';
    if (fixtureInfo.finished) return 'FT';
    if (fixtureInfo.finished_provisional) return 'FT*';
    if (fixtureInfo.started) return `${fixtureInfo.minutes || 0}'`;
    return '';
}

function calculateAutoSubs(xi, bench) {
    const autoSubs = [];
    
    const countPositions = (players) => {
        return players.reduce((acc, p) => {
            if (p.playerDone && p.didntPlay) return acc;
            acc[p.playerPosition] = (acc[p.playerPosition] || 0) + 1;
            return acc;
        }, {});
    };
    
    const isValidFormation = (gk, def, mid, fwd) => {
        return gk >= 1 && def >= 3 && fwd >= 1 && (gk + def + mid + fwd) <= 11;
    };
    
    const needsReplacing = xi.filter(p => p.playerDone && p.didntPlay);
    
    if (needsReplacing.length === 0) return autoSubs;
    
    for (const benchPlayer of bench) {
        if (benchPlayer.playerDone && benchPlayer.didntPlay) continue;
        
        for (const xiPlayer of needsReplacing) {
            if (autoSubs.includes(xiPlayer.position)) continue;
            
            const currentCounts = countPositions(xi.filter(p => !autoSubs.includes(p.position)));
            
            if (currentCounts[xiPlayer.playerPosition] > 0) {
                currentCounts[xiPlayer.playerPosition]--;
            }
            
            currentCounts[benchPlayer.playerPosition] = (currentCounts[benchPlayer.playerPosition] || 0) + 1;
            
            const { GKP = 0, DEF = 0, MID = 0, FWD = 0 } = currentCounts;
            
            if (isValidFormation(GKP, DEF, MID, FWD)) {
                autoSubs.push(benchPlayer.position);
                break;
            }
        }
        
        if (autoSubs.includes(benchPlayer.position)) {
            break;
        }
    }
    
    return autoSubs;
}

function displayMatches() {
    matchesContainer.innerHTML = '';
    
    // Sort teams by live points
    const sortedMatches = [...fakeMatches].sort((a, b) => {
        const teamA = teamsData[a.team1];
        const teamB = teamsData[b.team1];
        return (teamB?.livePoints || 0) - (teamA?.livePoints || 0);
    });
    
    sortedMatches.forEach((match, index) => {
        const team = teamsData[match.team1];
        if (!team) return;
        
        const matchDiv = document.createElement('div');
        matchDiv.className = 'match-container';
        
        // Create match header (just show the team as if it's vs empty opponent)
        const headerDiv = document.createElement('div');
        headerDiv.className = 'match-header';
        headerDiv.innerHTML = `
            <div class="team-header">
                <div class="team-info">
                    <span class="team-name">${team.name}</span>
                    <span class="manager-name">${team.manager}</span>
                </div>
                <span class="score">${team.livePoints}</span>
            </div>
            <div class="team-header">
                <div class="team-info">
                    <span class="team-name">Rank #${index + 1}</span>
                    <span class="manager-name">Live Position</span>
                </div>
                <span class="score">-</span>
            </div>
        `;
        
        // Create teams grid container
        const teamsGridDiv = document.createElement('div');
        teamsGridDiv.className = 'teams-grid';
        
        // Team grid
        const teamGridDiv = createTeamGrid(team);
        teamsGridDiv.appendChild(teamGridDiv);
        
        // Empty separator and grid for consistency
        const separatorDiv = document.createElement('div');
        separatorDiv.className = 'grid-separator';
        teamsGridDiv.appendChild(separatorDiv);
        
        const emptyGridDiv = document.createElement('div');
        emptyGridDiv.className = 'team-grid';
        teamsGridDiv.appendChild(emptyGridDiv);
        
        matchDiv.appendChild(headerDiv);
        matchDiv.appendChild(teamsGridDiv);
        matchesContainer.appendChild(matchDiv);
    });
    
    matchesContainer.classList.remove('hidden');
}

function createTeamGrid(team) {
    const gridDiv = document.createElement('div');
    gridDiv.className = 'team-grid';
    
    // XI header
    const xiHeader = document.createElement('div');
    xiHeader.className = 'grid-header';
    xiHeader.textContent = 'Starting XI';
    gridDiv.appendChild(xiHeader);
    
    // XI players
    const xiGrid = document.createElement('div');
    xiGrid.className = 'players-grid';
    
    team.xi.forEach(player => {
        const playerDiv = document.createElement('div');
        playerDiv.className = 'player-row';
        
        if (player.is_captain) playerDiv.classList.add('captain');
        if (player.is_vice_captain) playerDiv.classList.add('vice-captain');
        if (player.playerDone) playerDiv.classList.add('done');
        if (player.gameInProgress) playerDiv.classList.add('in-progress');
        if (player.bonusPending) playerDiv.classList.add('bonus-pending');
        
        const captainBadge = player.is_captain ? ' (C)' : (player.is_vice_captain ? ' (V)' : '');
        const multiplierText = player.multiplier > 1 ? ` x${player.multiplier}` : '';
        const statusIcon = player.playerDone ? '✓' : (player.gameInProgress ? '▶' : '');
        
        playerDiv.innerHTML = `
            <div class="player-info">
                <span class="player-name">${player.playerName}${captainBadge}</span>
                <span class="player-details">${player.playerPosition} ${player.displayTeam} ${player.fixtureStatus}</span>
            </div>
            <div class="player-stats">
                <span class="player-events">${player.eventEmojis}</span>
                <span class="player-points">${player.points}${multiplierText} ${statusIcon}</span>
            </div>
        `;
        
        xiGrid.appendChild(playerDiv);
    });
    
    gridDiv.appendChild(xiGrid);
    
    // Bench header
    const benchHeader = document.createElement('div');
    benchHeader.className = 'grid-header bench-header';
    benchHeader.textContent = 'Bench';
    gridDiv.appendChild(benchHeader);
    
    // Bench players
    const benchGrid = document.createElement('div');
    benchGrid.className = 'players-grid bench-grid';
    
    team.bench.forEach(player => {
        const playerDiv = document.createElement('div');
        playerDiv.className = 'player-row bench-player';
        
        if (player.willComeOn) {
            playerDiv.classList.add('will-come-on');
        }
        
        if (player.points > 0 && !player.didntPlay) {
            playerDiv.classList.add('bench-played');
        }
        
        const statusIcon = player.playerDone ? '✓' : (player.gameInProgress ? '▶' : '');
        
        playerDiv.innerHTML = `
            <div class="player-info">
                <span class="player-name">${player.playerName}</span>
                <span class="player-details">${player.playerPosition} ${player.displayTeam} ${player.fixtureStatus}</span>
            </div>
            <div class="player-stats">
                <span class="player-events">${player.eventEmojis}</span>
                <span class="player-points">${player.points} ${statusIcon}</span>
            </div>
        `;
        
        benchGrid.appendChild(playerDiv);
    });
    
    gridDiv.appendChild(benchGrid);
    
    return gridDiv;
}

// Event listeners
refreshBtn.addEventListener('click', loadData);

// Auto-refresh every 30 seconds
setInterval(loadData, 30000);

// Initial load
loadData();