// FPL API endpoints
const PROXY_URL = 'https://corsproxy.io/?';
const FPL_BASE_URL = 'https://fantasy.premierleague.com/api';

// Hardcoded H2H League
const H2H_LEAGUE_ID = 1017641;
const TEAM_IDS = [8431008, 785223, 6853564, 6309303, 3300973, 3466784, 6274965, 940183];
const DAVID_MACLEOD_TEAM_ID = 785223; // Fellaini's 11½
let currentGameweek = null;
let teamsData = {};
let playersData = {};
let teamsInfo = {};
let h2hMatches = [];
let fixturesData = {};

// Register service worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(err => console.log('SW registration failed'));
    });
}

// DOM elements
const loadingDiv = document.getElementById('loading');
const errorDiv = document.getElementById('error');
const matchesContainer = document.getElementById('matchesContainer');
const gwInfo = document.getElementById('gwInfo');
const refreshBtn = document.getElementById('refresh');

// Event listeners
refreshBtn.addEventListener('click', fetchLeagueData);

// Load on startup
window.addEventListener('load', () => {
    fetchLeagueData();
});

async function fetchWithProxy(url) {
    try {
        const response = await fetch(PROXY_URL + encodeURIComponent(url));
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return await response.json();
    } catch (error) {
        console.error('Fetch error:', error);
        throw error;
    }
}

async function fetchLeagueData() {
    showLoading(true);
    hideError();
    
    try {
        // Get current gameweek and player data
        const bootstrapData = await fetchWithProxy(`${FPL_BASE_URL}/bootstrap-static/`);
        currentGameweek = bootstrapData.events.find(gw => gw.is_current)?.id || 1;
        gwInfo.textContent = `GW${currentGameweek}`;
        
        // Store player data for reference
        bootstrapData.elements.forEach(player => {
            playersData[player.id] = {
                name: player.web_name,
                team: bootstrapData.teams.find(t => t.id === player.team)?.short_name || '',
                teamId: player.team,
                position: bootstrapData.element_types.find(t => t.id === player.element_type)?.singular_name_short || ''
            };
        });
        
        // Fetch fixtures for current gameweek to determine game status
        const fixturesResponse = await fetchWithProxy(`${FPL_BASE_URL}/fixtures/?event=${currentGameweek}`);
        fixturesResponse.forEach(fixture => {
            // Store detailed fixture info for each team
            const homeTeam = bootstrapData.teams.find(t => t.id === fixture.team_h);
            const awayTeam = bootstrapData.teams.find(t => t.id === fixture.team_a);
            
            
            const homeFixtureInfo = {
                finished: fixture.finished,
                finished_provisional: fixture.finished_provisional,
                started: fixture.started,
                minutes: fixture.minutes || 0,
                fixtureId: fixture.id,
                opponent: awayTeam?.short_name || '',
                isHome: true
            };
            const awayFixtureInfo = {
                finished: fixture.finished,
                finished_provisional: fixture.finished_provisional,
                started: fixture.started,
                minutes: fixture.minutes || 0,
                fixtureId: fixture.id,
                opponent: homeTeam?.short_name || '',
                isHome: false
            };
            fixturesData[fixture.team_h] = homeFixtureInfo;
            fixturesData[fixture.team_a] = awayFixtureInfo;
        });
        
        // Get H2H league standings to get team info
        const leagueData = await fetchWithProxy(`${FPL_BASE_URL}/leagues-h2h/${H2H_LEAGUE_ID}/standings/`);
        
        // Store team info
        leagueData.standings.results.forEach(team => {
            teamsInfo[team.entry] = {
                id: team.entry,
                name: team.entry_name,
                manager: team.player_name,
                won: team.matches_won,
                drawn: team.matches_drawn,
                lost: team.matches_lost,
                points: team.total
            };
        });
        
        // Get H2H matches for current gameweek
        await fetchH2HMatches();
        
        // Get live points and player details for all teams
        await fetchAllTeamDetails();
        
    } catch (error) {
        showError('Failed to load league');
        console.error('Error:', error);
    } finally {
        showLoading(false);
    }
}

async function fetchH2HMatches() {
    try {
        let allMatches = [];
        let page = 1;
        let hasMorePages = true;
        
        // Fetch all pages of H2H matches
        while (hasMorePages) {
            const matchesData = await fetchWithProxy(`${FPL_BASE_URL}/leagues-h2h-matches/league/${H2H_LEAGUE_ID}/?page=${page}`);
            
            if (matchesData.results && matchesData.results.length > 0) {
                allMatches = allMatches.concat(matchesData.results);
                page++;
                
                // Stop if we get less than 50 results (typical page size)
                if (matchesData.results.length < 50) {
                    hasMorePages = false;
                }
            } else {
                hasMorePages = false;
            }
            
            // Safety break after 10 pages
            if (page > 10) {
                hasMorePages = false;
            }
        }
        
        console.log(`Fetched ${allMatches.length} total matches from ${page - 1} pages`);
        
        // Filter for current gameweek matches
        h2hMatches = allMatches
            .filter(m => m.event === currentGameweek)
            .map(match => ({
                team1: match.entry_1_entry,
                team2: match.entry_2_entry
            }));
            
        console.log(`Found ${h2hMatches.length} matches for GW ${currentGameweek}`);
            
    } catch (error) {
        console.error('Error fetching H2H matches:', error);
    }
}

async function fetchAllTeamDetails() {
    if (!currentGameweek || Object.keys(teamsInfo).length === 0) return;
    
    refreshBtn.textContent = '⟳';
    refreshBtn.disabled = true;
    
    try {
        // Fetch live gameweek data once
        const liveData = await fetchWithProxy(`${FPL_BASE_URL}/event/${currentGameweek}/live/`);
        
        // Process each team
        const teamPromises = Object.keys(teamsInfo).map(async (teamId) => {
            try {
                // Fetch team picks
                const picksData = await fetchWithProxy(`${FPL_BASE_URL}/entry/${teamId}/event/${currentGameweek}/picks/`);
                
                // Process players with live data
                const players = picksData.picks.map(pick => {
                    const playerInfo = playersData[pick.element];
                    const liveStats = liveData.elements[pick.element - 1]?.stats || {};
                    
                    let points = liveStats.total_points || 0;
                    if (pick.is_captain) points *= 2;
                    
                    // Get fixture info for player's team
                    const fixtureInfo = playerInfo?.teamId ? fixturesData[playerInfo.teamId] : null;
                    
                    // Determine if player is "done" with more accurate logic
                    let playerDone = false;
                    let didntPlay = false;
                    let gameInProgress = false;
                    let bonusPending = false;
                    
                    if (fixtureInfo) {
                        const gameMinutes = fixtureInfo.minutes || 0;
                        const playerMinutes = liveStats.minutes || 0;
                        const hasRedCard = liveStats.red_cards > 0;
                        const hasBonus = liveStats.bonus > 0;
                        
                        // Check if game is in progress (started but whistle not yet blown)
                        gameInProgress = fixtureInfo.started && !fixtureInfo.finished_provisional;
                        
                        // Check if whistle blown but bonus points not yet awarded
                        bonusPending = fixtureInfo.finished_provisional && !fixtureInfo.finished && playerMinutes > 0;
                        
                        // Player is done if:
                        // 1. Game is fully finished (with bonus points awarded)
                        if (fixtureInfo.finished) {
                            playerDone = true;
                            didntPlay = playerMinutes === 0;
                        }
                        // 2. Game finished (whistle blown) - all players are done regardless of bonus status
                        else if (fixtureInfo.finished_provisional) {
                            playerDone = true;
                            didntPlay = playerMinutes === 0;
                        }
                        // 3. Game in progress and player got a red card
                        else if (hasRedCard) {
                            playerDone = true;
                        }
                        // 4. Game in progress and player was subbed off (started but played less than game minutes - 5)
                        else if (playerMinutes > 0 && playerMinutes < gameMinutes - 5 && liveStats.starts > 0) {
                            playerDone = true;
                        }
                    }
                    
                    const opponentTeam = fixtureInfo?.opponent || '';
                    const displayTeam = fixtureInfo?.isHome ? opponentTeam : opponentTeam.toLowerCase();
                    
                    // Generate event emojis based on stats
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
                    if (liveStats.saves > 2 && playerInfo?.position === 'GKP') {
                        eventEmojis += '🧤';
                    }
                    
                    return {
                        position: pick.position,
                        name: playerInfo?.name || 'Unknown',
                        team: displayTeam,
                        playerPosition: playerInfo?.position || '',
                        points: points,
                        isCaptain: pick.is_captain,
                        isViceCaptain: pick.is_vice_captain,
                        minutes: liveStats.minutes || 0,
                        playerDone: playerDone,
                        didntPlay: didntPlay,
                        eventEmojis: eventEmojis,
                        gameInProgress: gameInProgress,
                        bonusPending: bonusPending,
                        gameStarted: fixtureInfo?.started || false
                    };
                });
                
                // Sort into XI and bench
                const xi = players.filter(p => p.position <= 11).sort((a, b) => a.position - b.position);
                const bench = players.filter(p => p.position > 11).sort((a, b) => a.position - b.position);
                
                // Determine auto-substitutions according to FPL rules
                const autoSubs = calculateAutoSubs(xi, bench);
                
                // Mark bench players who will come on
                bench.forEach(player => {
                    player.willAutoSub = autoSubs.includes(player.position);
                });
                
                // Calculate total live points (including auto-subs)
                let livePoints = xi.reduce((sum, p) => sum + p.points, 0);
                // Add points from auto-subs
                bench.forEach(player => {
                    if (player.willAutoSub) {
                        livePoints += player.points;
                        // Subtract the points of the player being replaced
                        const replacedPlayer = xi.find(p => !p.didntPlay || p.position === player.position);
                        if (replacedPlayer && replacedPlayer.didntPlay) {
                            livePoints -= replacedPlayer.points;
                        }
                    }
                });
                livePoints -= (picksData.entry_history.event_transfers_cost || 0);
                
                teamsData[teamId] = {
                    ...teamsInfo[teamId],
                    xi: xi,
                    bench: bench,
                    livePoints: livePoints,
                    transfersCost: picksData.entry_history.event_transfers_cost || 0
                };
                
            } catch (error) {
                console.error(`Error fetching team ${teamId}:`, error);
                teamsData[teamId] = {
                    ...teamsInfo[teamId],
                    xi: [],
                    bench: [],
                    livePoints: 0
                };
            }
        });
        
        await Promise.all(teamPromises);
        
        // Display H2H matches with player grids
        displayMatches();
        
    } catch (error) {
        console.error('Error fetching team details:', error);
    } finally {
        refreshBtn.textContent = '↻';
        refreshBtn.disabled = false;
    }
}

function displayMatches() {
    matchesContainer.innerHTML = '';
    
    // Sort matches to prioritize David MacLeod's team
    const sortedMatches = [...h2hMatches].sort((a, b) => {
        const aHasDavid = a.team1 === DAVID_MACLEOD_TEAM_ID || a.team2 === DAVID_MACLEOD_TEAM_ID;
        const bHasDavid = b.team1 === DAVID_MACLEOD_TEAM_ID || b.team2 === DAVID_MACLEOD_TEAM_ID;
        return bHasDavid - aHasDavid;
    });
    
    sortedMatches.forEach((match) => {
        let team1 = teamsData[match.team1];
        let team2 = teamsData[match.team2];
        
        if (!team1 || !team2) return;
        
        // Always put David MacLeod's team on the left
        if (team2.id === DAVID_MACLEOD_TEAM_ID) {
            [team1, team2] = [team2, team1];
        }
        
        const matchDiv = document.createElement('div');
        matchDiv.className = 'match-container';
        
        // Create match header
        const headerDiv = document.createElement('div');
        headerDiv.className = 'match-header';
        headerDiv.innerHTML = `
            <div class="team-header">
                <div class="team-info">
                    <span class="team-name">${team1.name}</span>
                    <span class="manager-name">${team1.manager}</span>
                </div>
                <span class="score">${team1.transfersCost > 0 ? `<span class="points-hit">(-${team1.transfersCost}) </span>` : ''}${team1.livePoints}</span>
            </div>
            <div class="team-header">
                <div class="team-info">
                    <span class="team-name">${team2.name}</span>
                    <span class="manager-name">${team2.manager}</span>
                </div>
                <span class="score">${team2.transfersCost > 0 ? `<span class="points-hit">(-${team2.transfersCost}) </span>` : ''}${team2.livePoints}</span>
            </div>
        `;
        
        // Create teams grid container
        const teamsGridDiv = document.createElement('div');
        teamsGridDiv.className = 'teams-grid';
        
        // Team 1 grid
        const team1GridDiv = createTeamGrid(team1);
        teamsGridDiv.appendChild(team1GridDiv);
        
        // Separator
        const separatorDiv = document.createElement('div');
        separatorDiv.className = 'grid-separator';
        teamsGridDiv.appendChild(separatorDiv);
        
        // Team 2 grid
        const team2GridDiv = createTeamGrid(team2);
        teamsGridDiv.appendChild(team2GridDiv);
        
        matchDiv.appendChild(headerDiv);
        matchDiv.appendChild(teamsGridDiv);
        
        matchesContainer.appendChild(matchDiv);
    });
    
    matchesContainer.classList.remove('hidden');
}

function calculateAutoSubs(xi, bench) {
    // Returns array of bench positions that will auto-sub
    const autoSubs = [];
    
    // Count positions in starting XI
    const countPositions = (players) => {
        let gk = 0, def = 0, mid = 0, fwd = 0;
        players.forEach(p => {
            if (!p.willBeReplaced) {  // Don't count players being subbed out
                switch(p.playerPosition) {
                    case 'GKP': gk++; break;
                    case 'DEF': def++; break;
                    case 'MID': mid++; break;
                    case 'FWD': fwd++; break;
                }
            }
        });
        return { gk, def, mid, fwd };
    };
    
    // Check if formation is valid (min 3 DEF, 1 GK, 1 FWD)
    const isValidFormation = (gk, def, mid, fwd) => {
        return gk >= 1 && def >= 3 && fwd >= 1 && (gk + def + mid + fwd) <= 11;
    };
    
    // Find players who need replacing (done but didn't play)
    const needsReplacing = xi.filter(p => p.playerDone && p.didntPlay);
    
    if (needsReplacing.length === 0) return autoSubs;
    
    // Mark XI players who will be replaced
    xi.forEach(p => p.willBeReplaced = false);
    
    // Process each bench player in order
    for (const benchPlayer of bench) {
        // Skip if bench player didn't play
        if (benchPlayer.playerDone && benchPlayer.didntPlay) continue;
        
        // Try to find a player to replace
        for (const xiPlayer of needsReplacing) {
            // Skip if already replaced
            if (xiPlayer.willBeReplaced) continue;
            
            // GK can only replace GK
            if (xiPlayer.playerPosition === 'GKP') {
                if (benchPlayer.playerPosition === 'GKP') {
                    xiPlayer.willBeReplaced = true;
                    autoSubs.push(benchPlayer.position);
                    break;
                }
                continue;
            }
            
            // Outfield players - check formation validity
            if (benchPlayer.playerPosition !== 'GKP') {
                // Simulate the substitution
                const currentPositions = countPositions(xi);
                
                // Remove the player being replaced
                switch(xiPlayer.playerPosition) {
                    case 'DEF': currentPositions.def--; break;
                    case 'MID': currentPositions.mid--; break;
                    case 'FWD': currentPositions.fwd--; break;
                }
                
                // Add the bench player
                switch(benchPlayer.playerPosition) {
                    case 'DEF': currentPositions.def++; break;
                    case 'MID': currentPositions.mid++; break;
                    case 'FWD': currentPositions.fwd++; break;
                }
                
                // Check if formation is still valid
                if (isValidFormation(currentPositions.gk, currentPositions.def, currentPositions.mid, currentPositions.fwd)) {
                    xiPlayer.willBeReplaced = true;
                    autoSubs.push(benchPlayer.position);
                    break;
                }
            }
        }
        
        // Stop if we've made a substitution with this bench player
        if (autoSubs.includes(benchPlayer.position)) {
            needsReplacing.splice(needsReplacing.findIndex(p => p.willBeReplaced), 1);
        }
    }
    
    return autoSubs;
}

function createTeamGrid(team) {
    const gridDiv = document.createElement('div');
    gridDiv.className = 'team-grid';
    
    
    // XI players
    const xiGrid = document.createElement('div');
    xiGrid.className = 'players-grid';
    
    team.xi.forEach(player => {
        const playerDiv = document.createElement('div');
        playerDiv.className = 'player-row';
        
        // Add classes based on player status
        if (player.playerDone) {
            if (player.didntPlay) {
                playerDiv.classList.add('no-minutes');
            } else {
                playerDiv.classList.add('game-finished');
            }
        }
        
        // Map position codes to single letters
        const positionMap = {'GKP': 'G', 'DEF': 'D', 'MID': 'M', 'FWD': 'F'};
        const posLetter = positionMap[player.playerPosition] || '';
        
        let loadingIndicator = '';
        if (player.bonusPending) {
            loadingIndicator = '<span class="loading-indicator"><span style="color: #888;">•</span></span>';
        } else if (player.gameInProgress && !player.playerDone) {
            loadingIndicator = '<span class="loading-indicator"><span class="loading-dots">⬤</span></span>';
        }
        
        const displayPoints = !player.gameStarted ? '' : 
                              (player.didntPlay ? '-' : 
                               (player.gameInProgress && player.minutes === 0) ? '' : player.points);
        
        playerDiv.innerHTML = `
            <span class="player-name"><span class="position-badge">${posLetter}</span>${player.name}${player.isCaptain ? ' (C)' : player.isViceCaptain ? ' (V)' : ''} ${loadingIndicator}</span>
            <span class="player-team">${player.team}</span>
            <span class="player-points">${displayPoints}</span>
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
        
        // Border for auto-sub candidates
        if (player.willAutoSub) {
            playerDiv.classList.add('will-auto-sub');
        }
        
        // Background color based on playing status AND auto-sub status
        if (player.playerDone) {
            if (player.didntPlay) {
                // Red - didn't play
                playerDiv.classList.add('no-minutes');
            } else if (player.willAutoSub) {
                // Green - played AND will auto-sub
                playerDiv.classList.add('game-finished');
            } else {
                // Yellow - played but won't auto-sub
                playerDiv.classList.add('bench-played');
            }
        }
        
        // Map position codes to single letters
        const positionMap = {'GKP': 'G', 'DEF': 'D', 'MID': 'M', 'FWD': 'F'};
        const posLetter = positionMap[player.playerPosition] || '';
        
        let loadingIndicator = '';
        if (player.bonusPending) {
            loadingIndicator = '<span class="loading-indicator"><span style="color: #888;">•</span></span>';
        } else if (player.gameInProgress && !player.playerDone) {
            loadingIndicator = '<span class="loading-indicator"><span class="loading-dots">⬤</span></span>';
        }
        
        const displayPoints = !player.gameStarted ? '' : 
                              (player.didntPlay ? '-' : 
                               (player.gameInProgress && player.minutes === 0) ? '' : player.points);
        
        playerDiv.innerHTML = `
            <span class="player-name"><span class="position-badge">${posLetter}</span>${player.name} ${loadingIndicator}</span>
            <span class="player-team">${player.team}</span>
            <span class="player-points">${displayPoints}</span>
        `;
        
        benchGrid.appendChild(playerDiv);
    });
    
    gridDiv.appendChild(benchGrid);
    
    return gridDiv;
}

function showLoading(show) {
    if (show) {
        loadingDiv.classList.remove('hidden');
    } else {
        loadingDiv.classList.add('hidden');
    }
}

function showError(message) {
    errorDiv.textContent = message;
    errorDiv.classList.remove('hidden');
}

function hideError() {
    errorDiv.classList.add('hidden');
}