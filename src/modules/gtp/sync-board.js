const gametree = require('../gametree')
const helper = require('../helper')
const sgf = require('../sgf')
const Board = require('../board')
const Command = require('./command')

async function enginePlay(controller, sign, vertex, engineBoard) {
    let color = sign > 0 ? 'B' : 'W'
    let coord = engineBoard.vertex2coord(vertex)

    let {response} = await controller.sendCommand(new Command(null, 'play', color, coord))
    if (response.error) return null

    return engineBoard.makeMove(sign, vertex)
}

module.exports = async function(controller, engineBoard, treePosition) {
    let board = gametree.getBoard(...treePosition)

    if (!board.isSquare()) {
        throw new Error('GTP engines don’t support non-square boards.')
    } else if (!board.isValid()) {
        throw new Error('GTP engines don’t support invalid board positions.')
    }

    // Incremental board update

    let diff = engineBoard.diff(board).filter(v => board.get(v) !== 0)

    if (diff != null) {
        if (diff.length === 0) {
            return
        } else if (diff.length === 1) {
            let vertex = diff[0]
            let sign = board.get(vertex)
            let move = await enginePlay(controller, sign, vertex, engineBoard)

            if (move != null && move.getPositionHash() === board.getPositionHash())
                return
        }
    }

    // Replay

    await controller.sendCommand(new gtp.Command(null, 'boardsize', board.width))
    await controller.sendCommand(new gtp.Command(null, 'clear_board'))
    engineBoard = new Board(board.width, board.height)

    let tp = [gametree.getRoot(treePosition[0]), 0]

    while (tp != null) {
        let node = tp[0].nodes[tp[1]]
        let error = false

        for (let color of ['B', 'W']) {
            if (!(color in node)) continue

            let sign = color === 'B' ? 1 : -1
            let vertex = sgf.point2vertex(node[color][0])

            engineBoard = await enginePlay(controller, sign, vertex, engineBoard)
            if (engineBoard == null) error = true
        }

        if (error || 'AE' in node && node.AE.length > 0) break

        for (let prop of ['AB', 'AW']) {
            if (!(prop in node)) continue

            let sign = prop === 'AB' ? 1 : -1
            let points = node[prop].map(sgf.compressed2list).reduce((list, x) => [...list, ...x])
            let vertices = points.map(sgf.point2vertex(x))

            for (let vertex of vertices) {
                engineBoard = await enginePlay(controller, sign, vertex, engineBoard)

                if (engineBoard == null) {
                    error = true
                    break
                }
            }

            if (error) break
        }

        if (error || helper.vertexEquals(tp, treePosition)) break

        tp = gametree.navigate(...tp, 1)
    }

    if (engineBoard != null && engineBoard.getPositionHash() === board.getPositionHash())
        return

    // Rearrangement

    await controller.sendCommand(new gtp.Command(null, 'boardsize', board.width))
    await controller.sendCommand(new gtp.Command(null, 'clear_board'))
    engineBoard = new Board(board.width, board.height)

    for (let x = 0; x < board.width; x++) {
        if (engineBoard == null) break

        for (let y = 0; y < board.height; y++) {
            let vertex = [x, y]
            let sign = board.get(vertex)
            if (sign === 0) continue

            engineBoard = await enginePlay(controller, sign, vertex, engineBoard)
            if (engineBoard == null) break
        }
    }

    if (engineBoard != null && engineBoard.getPositionHash() === board.getPositionHash())
        return

    throw new Error('Current board arrangement can’t be recreated on the GTP engine.')
}
