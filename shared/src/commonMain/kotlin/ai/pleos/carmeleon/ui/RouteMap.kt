package ai.pleos.carmeleon.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Explore
import androidx.compose.material.icons.outlined.LocationOn
import androidx.compose.material.icons.outlined.Navigation
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import ai.pleos.carmeleon.core.JourneyState
import ai.pleos.carmeleon.core.DataOrigin

/** Schematic route composition. This never impersonates an embedded Pleos navigation map. */
@Composable
internal fun RouteMap(state: JourneyState, compact: Boolean, modifier: Modifier = Modifier) {
    val colors = LocalVehicleColors.current
    val committedStop = state.route.stops.drop(state.currentStopIndex).firstOrNull { it.kind != null }
    val currentCandidate = state.proposal.takeIf { state.proposalVisible }
    val candidateCommitted = currentCandidate != null && state.route.stops.any { it.id == currentCandidate.stop.id }
    val uncommittedProposal = currentCandidate != null && !candidateCommitted
    val shownStop = currentCandidate?.stop ?: committedStop
    val hasDetour = shownStop != null
    BoxWithConstraints(modifier.background(colors.map).testTag("route-map")) {
        Canvas(Modifier.fillMaxSize()) {
            fun point(x: Float, y: Float) = Offset(size.width * x, size.height * y)
            drawRect(colors.map)
            rotate(-24f) {
                val pitch = 110.dp.toPx()
                var x = -size.width
                while (x < size.width * 2) {
                    var y = -size.height
                    while (y < size.height * 2) {
                        drawRoundRect(colors.blocks, Offset(x + 5f, y + 5f), Size(pitch - 12f, pitch * .77f), androidx.compose.ui.geometry.CornerRadius(5.dp.toPx()))
                        y += pitch * .88f
                    }
                    x += pitch
                }
            }
            val river = Path().apply {
                moveTo(-40f, size.height * .48f)
                cubicTo(size.width * .2f, size.height * .63f, size.width * .29f, size.height * .29f, size.width * .58f, size.height * .34f)
                cubicTo(size.width * .75f, size.height * .40f, size.width * .94f, size.height * .09f, size.width + 30f, size.height * .06f)
            }
            drawPath(river, colors.river, style = Stroke(54.dp.toPx(), cap = StrokeCap.Round))
            val roads = listOf(
                listOf(point(-.1f,.12f),point(.24f,.38f),point(.44f,.54f),point(.72f,.78f),point(1.1f,.90f)),
                listOf(point(.12f,-.1f),point(.24f,.38f),point(.30f,1.1f)),
                listOf(point(.66f,-.1f),point(.63f,.34f),point(.72f,.78f),point(.58f,1.1f)),
            )
            roads.forEach { points ->
                val road = Path().apply { moveTo(points[0].x, points[0].y); points.drop(1).forEach { lineTo(it.x,it.y) } }
                drawPath(road, colors.roadOutline, style=Stroke(18.dp.toPx()))
                drawPath(road, colors.road, style=Stroke(13.dp.toPx()))
            }
            val original = Path().apply {
                moveTo(size.width*.19f,size.height*.76f)
                lineTo(size.width*.25f,size.height*.62f)
                quadraticBezierTo(size.width*.26f,size.height*.59f,size.width*.31f,size.height*.59f)
                lineTo(size.width*.44f,size.height*.54f)
                lineTo(size.width*.63f,size.height*.34f)
                lineTo(size.width*.76f,size.height*.30f)
            }
            drawPath(original, colors.road, style=Stroke(12.dp.toPx(),cap=StrokeCap.Round))
            drawPath(original, if(hasDetour) Color(0xFF929CA9) else colors.blue, style=Stroke(6.dp.toPx(),cap=StrokeCap.Round))
            if (hasDetour) {
                val detour = Path().apply {
                    moveTo(size.width*.31f,size.height*.59f)
                    lineTo(size.width*.39f,size.height*.72f)
                    quadraticBezierTo(size.width*.41f,size.height*.76f,size.width*.44f,size.height*.72f)
                    lineTo(size.width*.54f,size.height*.59f)
                    quadraticBezierTo(size.width*.56f,size.height*.56f,size.width*.54f,size.height*.53f)
                    lineTo(size.width*.51f,size.height*.47f)
                }
                if (committedStop != null) drawPath(detour, colors.blue, style=Stroke(6.dp.toPx(),cap=StrokeCap.Round))
                if (uncommittedProposal) {
                    // Separate schematic branch: a new candidate must not replace the confirmed line.
                    val proposedPath = if (committedStop == null) detour else Path().apply {
                        moveTo(size.width*.25f,size.height*.62f)
                        lineTo(size.width*.15f,size.height*.57f)
                        quadraticBezierTo(size.width*.08f,size.height*.51f,size.width*.15f,size.height*.46f)
                        lineTo(size.width*.23f,size.height*.48f)
                        lineTo(size.width*.31f,size.height*.59f)
                    }
                    drawPath(proposedPath, colors.blue, style=Stroke(6.dp.toPx(),cap=StrokeCap.Round,pathEffect=PathEffect.dashPathEffect(floatArrayOf(9.dp.toPx(),9.dp.toPx()))))
                }
            }
        }

        if (!compact && state.route.origin == DataOrigin.PREVIEW) {
            Text("장안구", Modifier.offset(maxWidth * .08f, maxHeight * .22f), style=MaterialTheme.typography.titleMedium,color=colors.mapLabel)
            Text("행궁동", Modifier.offset(maxWidth * .37f, maxHeight * .24f), style=MaterialTheme.typography.bodySmall,color=colors.mapLabel)
            Text("수원천", Modifier.offset(maxWidth * .66f, maxHeight * .48f), style=MaterialTheme.typography.bodySmall,color=colors.mapLabel)
        }
        Surface(Modifier.align(Alignment.TopStart).padding(18.dp).widthIn(max=260.dp),shape=RoundedCornerShape(7.dp),color=colors.surface,shadowElevation=5.dp) {
            Row(Modifier.padding(horizontal=16.dp,vertical=15.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(10.dp)) {
                Icon(Icons.Outlined.Navigation,null,Modifier.size(20.dp))
                Column(verticalArrangement=Arrangement.spacedBy(3.dp)) {
                    Text(state.route.destination?.name ?: "목적지를 선택해 주세요",style=MaterialTheme.typography.titleSmall,maxLines=1)
                    if(state.location==null)Text("현재 위치 미확인",style=MaterialTheme.typography.labelSmall,color=colors.secondary,modifier=Modifier.testTag("location-unknown"))
                }
            }
        }
        Column(Modifier.align(Alignment.TopEnd).padding(20.dp),horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(5.dp)) {
            Icon(Icons.Outlined.Explore,null,Modifier.size(25.dp),tint=colors.secondary)
            Text("N",style=MaterialTheme.typography.labelSmall,color=colors.secondary)
        }
        val destinationTop = if (compact) 105.dp else maxHeight * .22f
        if (!state.proposalVisible) Surface(Modifier.align(Alignment.TopEnd).padding(top=destinationTop,end=if(compact)18.dp else 70.dp),shape=RoundedCornerShape(6.dp),color=colors.surface,shadowElevation=4.dp) {
            Row(Modifier.padding(horizontal=12.dp,vertical=11.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(7.dp)) {
                Icon(Icons.Outlined.LocationOn,null,Modifier.size(19.dp))
                Text(state.route.destination?.name ?: "목적지",style=MaterialTheme.typography.bodySmall)
            }
        }
        Box(Modifier.offset(if(compact)26.dp else maxWidth*.16f,if(compact)112.dp else maxHeight*.70f).size(43.dp).background(colors.surface,CircleShape).padding(4.dp).background(colors.blue,CircleShape),contentAlignment=Alignment.Center) {
            Icon(Icons.Outlined.Navigation,if(state.location==null)"현재 위치 미확인 · 경로 예시 표시" else "현재 위치 개념 표시",Modifier.size(23.dp),tint=Color.White)
        }
        if (shownStop != null) {
            Surface(Modifier.offset(if(compact)92.dp else 16.dp,if(compact)103.dp else maxHeight*.46f)
                .testTag(if(uncommittedProposal)"map-proposal-marker" else "map-committed-marker")
                .semantics { contentDescription = "${if(uncommittedProposal)"제안 경유지" else "확정 경유지"} ${shownStop.name}" },shape=RoundedCornerShape(6.dp),color=colors.surface,shadowElevation=4.dp) {
                Row(Modifier.padding(horizontal=12.dp,vertical=11.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(7.dp)) {
                    Icon(poiIcon(shownStop.kind),null,Modifier.size(18.dp),tint=colors.blue)
                    Text(if(uncommittedProposal)"제안 · +${currentCandidate?.extraDrivingMinutes ?: 0}분" else "다음 경유지",style=MaterialTheme.typography.bodySmall,color=colors.blue)
                }
            }
        }
        Text("경로 개념도 · ${originLabel(state.route.origin)}",Modifier.align(Alignment.BottomEnd).padding(12.dp),style=MaterialTheme.typography.labelSmall,color=colors.mapLabel)
    }
}
