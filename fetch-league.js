// Quick script to fetch league data and get team IDs
const PROXY_URL = 'https://corsproxy.io/?';
const FPL_BASE_URL = 'https://fantasy.premierleague.com/api';
const LEAGUE_ID = 1017641;

async function fetchLeagueInfo() {
    try {
        // Get H2H league standings
        const response = await fetch(PROXY_URL + encodeURIComponent(`${FPL_BASE_URL}/leagues-h2h/${LEAGUE_ID}/standings/`));
        const data = await response.json();
        
        console.log('League Name:', data.league.name);
        console.log('Number of teams:', data.standings.results.length);
        console.log('\nTeam IDs and Names:');
        
        const teams = data.standings.results.map(team => ({
            id: team.entry,
            name: team.entry_name,
            manager: team.player_name
        }));
        
        teams.forEach(team => {
            console.log(`${team.id}: ${team.name} (${team.manager})`);
        });
        
        console.log('\nTeam IDs array:');
        console.log(JSON.stringify(teams.map(t => t.id)));
        
        // Get current H2H matches
        const matchesResponse = await fetch(PROXY_URL + encodeURIComponent(`${FPL_BASE_URL}/leagues-h2h-matches/league/${LEAGUE_ID}/`));
        const matchesData = await matchesResponse.json();
        
        console.log('\nCurrent gameweek H2H matches:');
        const currentGw = matchesData.results[0]?.event;
        const currentMatches = matchesData.results.filter(m => m.event === currentGw);
        
        currentMatches.forEach(match => {
            console.log(`${match.entry_1_entry} vs ${match.entry_2_entry}`);
        });
        
    } catch (error) {
        console.error('Error:', error);
    }
}

fetchLeagueInfo();