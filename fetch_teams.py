import requests
import json

# FPL API endpoints
FPL_BASE_URL = 'https://fantasy.premierleague.com/api'
H2H_LEAGUE_ID = 1017641

def fetch_h2h_league_teams():
    """Fetch all team IDs from the H2H league"""
    
    # Get H2H league standings
    url = f'{FPL_BASE_URL}/leagues-h2h/{H2H_LEAGUE_ID}/standings/'
    response = requests.get(url)
    data = response.json()
    
    print(f"League Name: {data['league']['name']}")
    print(f"Number of teams: {len(data['standings']['results'])}")
    print("\nTeams in league:")
    print("-" * 50)
    
    teams = []
    for team in data['standings']['results']:
        teams.append({
            'id': team['entry'],
            'name': team['entry_name'],
            'manager': team['player_name']
        })
        print(f"ID: {team['entry']:8} | {team['entry_name'][:25]:<25} | {team['player_name']}")
    
    # Get team IDs as array for hardcoding
    team_ids = [team['id'] for team in teams]
    print("\nTeam IDs array for hardcoding:")
    print(json.dumps(team_ids))
    
    # Get current H2H matches
    print("\nFetching current gameweek H2H matches...")
    matches_url = f'{FPL_BASE_URL}/leagues-h2h-matches/league/{H2H_LEAGUE_ID}/'
    matches_response = requests.get(matches_url)
    matches_data = matches_response.json()
    
    if matches_data['results']:
        current_gw = matches_data['results'][0]['event']
        print(f"\nGameweek {current_gw} H2H Matchups:")
        print("-" * 50)
        
        current_matches = [m for m in matches_data['results'] if m['event'] == current_gw]
        
        for match in current_matches:
            team1_name = next((t['name'] for t in teams if t['id'] == match['entry_1_entry']), 'Unknown')
            team2_name = next((t['name'] for t in teams if t['id'] == match['entry_2_entry']), 'Unknown')
            print(f"{team1_name[:20]:<20} vs {team2_name[:20]:<20}")
    
    return teams

if __name__ == "__main__":
    fetch_h2h_league_teams()