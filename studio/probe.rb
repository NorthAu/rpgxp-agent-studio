module StudioProbe
  class << self
    attr_accessor :key, :direction

    def report(status, detail)
      File.open("studio-probe.result", "wb") { |file| file.write(status + "\n" + detail + "\n" + @trace.join("\n")) }
      @finished = true
      $scene = nil
    end

    def init(steps)
      @steps, @index, @trace = steps, 0, []
      @key, @direction, @wait, @frames = nil, 0, 0, 0
      @finished = false
    end

    def ready(window)
      window.visible && window.instance_variable_get(:@contents_showing) &&
        !window.instance_variable_get(:@fade_in)
    end

    def tick(window)
      return if @finished
      @key, @direction = nil, 0
      if @wait > 0
        @wait -= 1
        return
      end
      step = @steps[@index]
      if step.nil?
        report("PASS", "#{@index} steps")
        return
      end
      @frames += 1
      if @frames > 240
        report("FAIL", "Step #{@index + 1} #{step[0]} timed out. Map #{$game_map.map_id}, player #{$game_player.x},#{$game_player.y}, message #{window.studio_text.inspect}")
        return
      end
      idle = !$game_player.moving? && !$game_temp.message_window_showing && !$game_system.map_interpreter.running?
      passed = false
      case step[0]
      when "at"
        passed = idle && [$game_map.map_id, $game_player.x, $game_player.y] == step[1, 3]
      when "move"
        if idle
          delta = {2 => [0, 1], 4 => [-1, 0], 6 => [1, 0], 8 => [0, -1]}[step[1]]
          @move_start ||= [$game_player.x, $game_player.y]
          if [$game_player.x, $game_player.y] == [@move_start[0] + delta[0], @move_start[1] + delta[1]]
            passed = true
            @move_start = nil
          else
            @direction = step[1]
          end
        end
      when "interact"
        if idle
          @key = Input::C
          @wait = 2
          passed = true
        end
      when "text"
        if ready(window) && $game_temp.choice_max == 0 && window.studio_text.include?(step[1])
          @key = Input::C
          @wait = 2
          passed = true
        end
      when "choose"
        if ready(window) && $game_temp.choice_max > step[1]
          if window.index == step[1]
            @key = Input::C
            passed = true
          else
            @key = Input::DOWN
          end
          @wait = 2
        end
      when "switch"
        passed = $game_switches[step[1]] == step[2]
      when "gold"
        passed = $game_party.gold == step[1]
      when "wait"
        @wait = step[1]
        passed = true
      end
      if passed
        @trace.push("#{@index + 1}. " + step.inspect)
        @frames = 0
        @index += 1
      end
    end
  end
end

class Window_Message
  attr_reader :studio_text
  alias studio_original_refresh refresh
  def refresh
    @studio_text = $game_temp.message_text.to_s.dup
    studio_original_refresh
  end
end

module Input
  class << self
    def dir4
      StudioProbe.direction || 0
    end
    def trigger?(code)
      StudioProbe.key == code
    end
    def repeat?(code)
      StudioProbe.key == code
    end
  end
end

class Scene_Title
  alias studio_original_main main
  def main
    studio_original_main
  rescue StandardError => error
    StudioProbe.report("FAIL", "#{error.class}: #{error.message}\n#{error.backtrace[0, 8].join("\n")}")
  end

  alias studio_original_update update
  def update
    if @studio_started
      studio_original_update
    else
      @studio_started = true
      StudioProbe.key = Input::C
      studio_original_update
      StudioProbe.key = nil
    end
  end
end

class Scene_Map
  alias studio_original_main main
  def main
    studio_original_main
  rescue StandardError => error
    StudioProbe.report("FAIL", "#{error.class}: #{error.message}\n#{error.backtrace[0, 8].join("\n")}")
  end

  alias studio_original_update update
  def update
    StudioProbe.tick(@message_window)
    studio_original_update if $scene == self
  end
end
