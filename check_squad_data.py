import requests
import json

FPL_BASE_URL = 'https://fantasy.premierleague.com/api'

# Get current gameweek
bootstrap = requests.get(f'{FPL_BASE_URL}/bootstrap-static/').json()
current_gw = next(gw['id'] for gw in bootstrap['events'] if gw['is_current'])

print(f"Checking for squad/lineup data (GW{current_gw}):")
print("=" * 60)

# Check bootstrap-static for any squad/lineup hints
print("\nChecking player data for squad indicators...")
sample_player = bootstrap['elements'][0]
print(f"Sample player fields: {list(sample_player.keys())}")

# Look for relevant fields
relevant_fields = ['squad_number', 'status', 'chance_of_playing_this_round', 
                   'chance_of_playing_next_round', 'news', 'news_added']
print(f"\nRelevant player fields:")
for field in relevant_fields:
    if field in sample_player:
        print(f"  {field}: {sample_player[field]}")

# Check live data for squad information
live_data = requests.get(f'{FPL_BASE_URL}/event/{current_gw}/live/').json()
print(f"\nChecking live data for squad info...")
if live_data['elements']:
    sample_live = live_data['elements'][0]
    print(f"Live data fields: {list(sample_live.keys())}")
    
    # Check if there's any explain data that might indicate squad status
    if 'explain' in sample_live and sample_live['explain']:
        print(f"Explain data available: {sample_live['explain'][0].keys() if sample_live['explain'] else 'None'}")

# Get fixtures to see if they have lineup data
fixtures = requests.get(f'{FPL_BASE_URL}/fixtures/?event={current_gw}').json()

print(f"\nChecking fixtures for lineup data...")
for fixture in fixtures[:2]:
    print(f"\nFixture: Team {fixture['team_h']} vs Team {fixture['team_a']}")
    print(f"  Started: {fixture.get('started', False)}")
    print(f"  Minutes: {fixture.get('minutes', 0)}")
    
    # Check if stats contain lineup info
    if 'stats' in fixture:
        for stat in fixture['stats']:
            if 'lineup' in stat.get('identifier', '').lower() or 'squad' in stat.get('identifier', '').lower():
                print(f"  Found lineup stat: {stat}")

# Try player status for upcoming/ongoing games
print("\n" + "=" * 60)
print("Checking player statuses and news...")

# Find players with interesting statuses
injured_players = []
doubtful_players = []
for player in bootstrap['elements'][:500]:
    if player['status'] != 'a':  # Not available
        status_map = {
            'd': 'Doubtful',
            'i': 'Injured', 
            'n': 'Not available',
            's': 'Suspended',
            'u': 'Unavailable'
        }
        player_status = status_map.get(player['status'], player['status'])
        
        if player['chance_of_playing_this_round'] is not None and player['chance_of_playing_this_round'] < 100:
            doubtful_players.append({
                'name': player['web_name'],
                'status': player_status,
                'chance': player['chance_of_playing_this_round'],
                'news': player['news']
            })

print(f"\nPlayers with availability issues:")
for p in doubtful_players[:5]:
    print(f"  {p['name']}: {p['status']} - {p['chance']}% chance - {p['news']}")

print("\n" + "=" * 60)
print("CONCLUSION:")
print("- No direct squad/lineup data before kickoff")
print("- 'chance_of_playing_this_round' gives injury/suspension probability")
print("- 'news' field provides injury updates")
print("- Can't definitively know if player is not in matchday squad until game starts")
print("- Best we can do: flag players with < 75% chance as 'doubtful'")