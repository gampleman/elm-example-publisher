port module ExamplePublisher exposing (Document, Example, Program, application)

{-| -}

import Browser
import Html exposing (Html)
import Json.Decode as Decode exposing (Decoder, Value)
import Json.Encode


type alias Document =
    { title : String
    , body : List (Html Never)
    , meta : List ( String, String )
    }


type alias Example tags =
    { filename : String
    , basename : String
    , tags : tags
    , width : Int
    , height : Int
    , source : String
    , description : String
    , ellieLink : Maybe String
    }


type alias Model tags =
    { target : Target tags
    }


type Target tags
    = Index (List (Example tags))
    | Show (Example tags) (List (Example tags))


type Msg
    = Noop


type alias Program tags =
    Platform.Program Value (Model tags) Msg


application :
    { tagDecoder : Decoder tags
    , indexView : List (Example tags) -> Document
    , showView : Example tags -> List (Example tags) -> Document
    }
    -> Program tags
application config =
    Browser.document
        { init = init config
        , view = view config.indexView config.showView
        , update = \_ model -> ( model, Cmd.none )
        , subscriptions = \_ -> Sub.none
        }


port renderPagePort : Value -> Cmd msg


renderPage : String -> List ( String, String ) -> Cmd msg
renderPage name meta =
    renderPagePort
        (Json.Encode.object
            [ ( "name", Json.Encode.string name )
            , ( "meta"
              , Json.Encode.list
                    (\( k, v ) ->
                        Json.Encode.object
                            [ ( "key", Json.Encode.string k )
                            , ( "value", Json.Encode.string v )
                            ]
                    )
                    meta
              )
            ]
        )


port errorPort : String -> Cmd msg


init config flags =
    case Decode.decodeValue (flagsDecoder config.tagDecoder) flags of
        Ok ((Index examples) as target) ->
            ( { target = target }, renderPage "index" (config.indexView examples).meta )

        Ok ((Show example examples) as target) ->
            ( { target = target }, renderPage example.basename (config.showView example examples).meta )

        Err errr ->
            ( { target = Index [] }, errorPort (Decode.errorToString errr) )


renderShowView : (Example tags -> List (Example tags) -> Document) -> String -> List (Example tags) -> Document
renderShowView showView name examples =
    case
        List.filter (\ex -> ex.basename == name) examples
            |> List.head
    of
        Just current ->
            showView current examples

        Nothing ->
            { body = [], title = "error", meta = [] }


view listView showView model =
    let
        { body, title } =
            case model.target of
                Index examples ->
                    listView examples

                Show example examples ->
                    showView example examples
    in
    { body = List.map (Html.map never) body, title = title }


flagsDecoder tagDecoder =
    Decode.map2 Tuple.pair
        (Decode.field "render" Decode.string)
        (Decode.field "examples" (exampleDecoder tagDecoder))
        |> Decode.andThen
            (\( target, examples ) ->
                if target == "index" then
                    Decode.succeed (Index examples)

                else
                    case List.filter (\example -> example.basename == target) examples |> List.head of
                        Just example ->
                            Decode.succeed (Show example examples)

                        Nothing ->
                            Decode.fail "Couldn't find example to render"
            )


exampleDecoder tagDecoder =
    Decode.list
        (Decode.map8
            (\filename basename tags width height source description ellieLink ->
                { filename = filename
                , basename = basename
                , tags = tags
                , width = width
                , height = height
                , source = source
                , description = description
                , ellieLink = ellieLink
                }
            )
            (Decode.field "filename" Decode.string)
            (Decode.field "basename" Decode.string)
            (Decode.field "tags" tagDecoder)
            (Decode.field "width" Decode.int)
            (Decode.field "height" Decode.int)
            (Decode.field "source" Decode.string)
            (Decode.field "description" Decode.string)
            (Decode.maybe (Decode.at [ "tags", "ellieLink" ] Decode.string))
        )
