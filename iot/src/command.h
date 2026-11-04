#pragma once

#include <ArduinoJson.h>

namespace appliances {

constexpr const char* channels[] = {"d1", "d2", "d3"};
constexpr size_t channelCount = sizeof(channels) / sizeof(channels[0]);

enum class Switch { unchanged, off, on };
using Command = Switch[channelCount];

// Validate every field before the caller touches any output.
inline bool parseCommand(const uint8_t* payload, size_t size, const char* password, Command& command) {
    JsonDocument document;
    if (deserializeJson(document, payload, size) || !password[0] ||
        document["password"].as<JsonString>() != JsonString(password)) {
        return false;
    }

    const auto pins = document["pins"].as<JsonObjectConst>();
    if (pins.size() == 0 || pins.size() > channelCount) return false;

    for (auto pair : pins) {
        size_t index = 0;
        while (index < channelCount && pair.key() != JsonString(channels[index])) ++index;
        if (index == channelCount) return false;

        const auto value = pair.value().as<JsonString>();
        if (value == JsonString("on") || value == JsonString("high")) command[index] = Switch::on;
        else if (value == JsonString("off") || value == JsonString("low")) command[index] = Switch::off;
        else return false;
    }
    return true;
}

} // namespace appliances
