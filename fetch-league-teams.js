// Fetch team details for FPL League 1549023
const FPL_BASE_URL = 'https://fantasy.premierleague.com/api';
const LEAGUE_ID = 1549023;

async function fetchData(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.json();
}

async function fetchLeagueTeams() {
    try {
        console.log(`\n🏆 Fetching league details for ID: ${LEAGUE_ID}\n`);

        // Get bootstrap data for player and team info
        console.log('Fetching bootstrap data...');
        const bootstrapData = await fetchData(`${FPL_BASE_URL}/bootstrap-static/`);
        const currentGW = bootstrapData.events.find(gw => gw.is_current);

        console.log(`Current Gameweek: ${currentGW.id}`);

        // Get league standings
        console.log('Fetching league standings...');
        const leagueData = await fetchData(`${FPL_BASE_URL}/leagues-classic/${LEAGUE_ID}/standings/`);

        console.log(`\nLeague: ${leagueData.league.name}`);
        console.log(`Total Teams: ${leagueData.standings.results.length}\n`);
        console.log('='.repeat(80));

        // Fetch detailed data for each team
        const standings = leagueData.standings.results;

        for (let i = 0; i < standings.length; i++) {
            const standing = standings[i];
            const teamId = standing.entry;

            console.log(`\n[${i + 1}] ${standing.entry_name} - ${standing.player_name}`);
            console.log('-'.repeat(80));

            try {
                // Get team details
                const teamData = await fetchData(`${FPL_BASE_URL}/entry/${teamId}/`);

                // Get current gameweek picks
                const pickData = await fetchData(`${FPL_BASE_URL}/entry/${teamId}/event/${currentGW.id}/picks/`);

                console.log(`Team ID: ${teamId}`);
                console.log(`Overall Points: ${teamData.summary_overall_points}`);
                console.log(`Overall Rank: ${teamData.summary_overall_rank?.toLocaleString()}`);
                console.log(`GW${currentGW.id} Points: ${pickData.entry_history.points}`);
                console.log(`Team Value: £${(teamData.last_deadline_value / 10).toFixed(1)}m`);
                console.log(`Bank: £${(teamData.last_deadline_bank / 10).toFixed(1)}m`);

                // Display squad
                console.log(`\nSquad for GW${currentGW.id}:`);

                const xi = pickData.picks.filter(p => p.position <= 11);
                const bench = pickData.picks.filter(p => p.position > 11);

                console.log('\nStarting XI:');
                xi.forEach(pick => {
                    const player = bootstrapData.elements.find(p => p.id === pick.element);
                    const team = bootstrapData.teams.find(t => t.id === player.team);
                    const posName = ['GKP', 'DEF', 'MID', 'FWD'][player.element_type - 1];
                    const captain = pick.is_captain ? ' (C)' : pick.is_vice_captain ? ' (V)' : '';

                    console.log(`  ${pick.position}. ${player.web_name}${captain} - ${posName} (${team.short_name})`);
                });

                console.log('\nBench:');
                bench.forEach(pick => {
                    const player = bootstrapData.elements.find(p => p.id === pick.element);
                    const team = bootstrapData.teams.find(t => t.id === player.team);
                    const posName = ['GKP', 'DEF', 'MID', 'FWD'][player.element_type - 1];

                    console.log(`  ${pick.position - 11}. ${player.web_name} - ${posName} (${team.short_name})`);
                });

                // Small delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 100));

            } catch (error) {
                console.error(`  ❌ Error fetching details: ${error.message}`);
            }

            console.log('='.repeat(80));
        }

        // Summary
        console.log('\n📊 SUMMARY');
        console.log('='.repeat(80));
        console.log(`Total teams processed: ${standings.length}`);
        console.log(`League ID: ${LEAGUE_ID}`);
        console.log(`League URL: https://fantasy.premierleague.com/leagues/${LEAGUE_ID}/standings/`);

    } catch (error) {
        console.error('\n❌ Error:', error.message);
        throw error;
    }
}

// Run the script
fetchLeagueTeams();
