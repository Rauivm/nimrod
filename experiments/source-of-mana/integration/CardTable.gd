extends RefCounted

const UpstreamCards = preload("res://sources/scripts/tonori/tulimshar/Hyland.gd")

# Recreational highest-card game: one server-dealt card each, ace high, ties draw.
var games: Dictionary = {}
var serial: int = 0

func Busy(peer_id: int) -> bool:
	for game in games.values():
		if peer_id in game.players:
			return true
	return false

func Invite(caller: int, target: int) -> bool:
	if caller == target or Busy(caller) or Busy(target):
		return false
	serial += 1
	games[serial] = {"id": serial, "players": [caller, target], "stage": "invite", "revealed": [],
		"cards": [], "winner": 0, "deadline": Time.get_ticks_msec() + 45000}
	return true

func Act(peer_id: int, game_id: int, action: String) -> bool:
	var game: Dictionary = games.get(game_id, {})
	if game.is_empty() or peer_id not in game.players or Time.get_ticks_msec() >= game.deadline:
		return false
	if action == "decline" and game.stage == "invite" and peer_id == game.players[1]:
		games.erase(game_id)
		return true
	if action == "accept" and game.stage == "invite" and peer_id == game.players[1]:
		var deck: Array = UpstreamCards._NewDeck()
		game.cards = [_rank(int(deck[0])), _rank(int(deck[1]))]
		game.stage = "playing"
		game.deadline = Time.get_ticks_msec() + 120000
		return true
	if action == "reveal" and game.stage == "playing" and peer_id not in game.revealed:
		game.revealed.append(peer_id)
		if game.revealed.size() == 2:
			game.stage = "finished"
			game.winner = game.players[0] if game.cards[0] > game.cards[1] else game.players[1] if game.cards[1] > game.cards[0] else 0
			game.deadline = Time.get_ticks_msec() + 15000
		return true
	return false

func _rank(card: int) -> int:
	return 14 if card % 13 == 0 else card % 13 + 1

func Prune(connected: Array) -> bool:
	var changed: bool = false
	for id in games.keys():
		var game: Dictionary = games[id]
		if Time.get_ticks_msec() >= game.deadline or game.players[0] not in connected or game.players[1] not in connected:
			games.erase(id)
			changed = true
	return changed

func Snapshot(peer_id: int) -> Dictionary:
	for game in games.values():
		if peer_id in game.players:
			var result: Dictionary = game.duplicate(true)
			# Never send undealt/hidden opponent cards or server deadlines.
			result.erase("deadline")
			if game.stage != "finished":
				result.cards = []
			return result
	return {}
