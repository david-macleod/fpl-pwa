import requests
import json

FPL_BASE_URL = 'https://fantasy.premierleague.com/api'

# Get current gameweek
bootstrap = requests.get(f'{FPL_BASE_URL}/bootstrap-static/').json()
current_gw = next(gw['id'] for gw in bootstrap['events'] if gw['is_current'])

# Get live data
live_data = requests.get(f'{FPL_BASE_URL}/event/{current_gw}/live/').json()

# Get fixtures for current gameweek
fixtures = requests.get(f'{FPL_BASE_URL}/fixtures/?event={current_gw}').json()

# Create a mapping of team to fixture status
team_fixture_status = {}
for fixture in fixtures:
    team_fixture_status[fixture['team_h']] = {
        'finished': fixture['finished'],
        'finished_provisional': fixture['finished_provisional'],
        'started': fixture['started'],
        'minutes': fixture.get('minutes', 0),
        'fixture_id': fixture['id']
    }
    team_fixture_status[fixture['team_a']] = {
        'finished': fixture['finished'],
        'finished_provisional': fixture['finished_provisional'],
        'started': fixture['started'],
        'minutes': fixture.get('minutes', 0),
        'fixture_id': fixture['id']
    }

print("Checking player status determination:")
print("=" * 50)

# Check some players with different statuses
players_to_check = [
    # Check some specific scenarios
    {'id': 100, 'name': 'Sample Player 1'},
    {'id': 200, 'name': 'Sample Player 2'},
    {'id': 300, 'name': 'Sample Player 3'},
]

# Actually, let's check real players with minutes
players_with_minutes = []
players_with_red_cards = []
players_with_zero_minutes_finished_game = []

for i, element in enumerate(live_data['elements'][:500]):  # Check first 500 players
    stats = element['stats']
    player_id = i + 1
    
    # Get player info from bootstrap
    player_info = next((p for p in bootstrap['elements'] if p['id'] == player_id), None)
    if not player_info:
        continue
    
    team_id = player_info['team']
    fixture_status = team_fixture_status.get(team_id, {})
    
    # Different scenarios
    if stats['red_cards'] > 0:
        players_with_red_cards.append({
            'name': player_info['web_name'],
            'minutes': stats['minutes'],
            'red_cards': stats['red_cards'],
            'game_finished': fixture_status.get('finished', False),
            'game_minutes': fixture_status.get('minutes', 0)
        })
    
    if fixture_status.get('finished') and stats['minutes'] == 0:
        players_with_zero_minutes_finished_game.append({
            'name': player_info['web_name'],
            'team': player_info['team'],
            'minutes': stats['minutes']
        })
    
    if stats['minutes'] > 0 and stats['minutes'] < 90 and fixture_status.get('minutes', 0) >= 90:
        players_with_minutes.append({
            'name': player_info['web_name'],
            'minutes': stats['minutes'],
            'game_minutes': fixture_status.get('minutes', 0),
            'game_finished': fixture_status.get('finished', False),
            'likely_subbed': True
        })

print("\nPlayers with red cards:")
for p in players_with_red_cards[:3]:
    print(f"  {p['name']}: {p['minutes']} mins, Red cards: {p['red_cards']}, Game finished: {p['game_finished']}")

print("\nPlayers likely subbed off (played < 90 but game at 90+):")
for p in players_with_minutes[:5]:
    print(f"  {p['name']}: {p['minutes']} mins, Game at {p['game_minutes']} mins")

print("\nPlayers with 0 minutes in finished games:")
for p in players_with_zero_minutes_finished_game[:5]:
    print(f"  {p['name']}: Didn't play (game finished)")

print("\n" + "=" * 50)
print("Key insights for determining if player is 'done':")
print("1. If game is finished OR finished_provisional → Player is done")
print("2. If player has red_card > 0 → Player is done")
print("3. If player minutes > 0 AND < game minutes - 5 → Likely subbed off")
print("4. If game minutes >= 90 AND player minutes = 0 → Unused sub")
print("5. If game started AND player minutes = 0 AND game minutes > 70 → Very likely unused")